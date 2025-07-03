import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAllWarehouses from '@salesforce/apex/InventoryController.getAllWarehouses';
import getProductByBarcode from '@salesforce/apex/InventoryController.getProductByBarcode';
import createInventoryTransaction from '@salesforce/apex/InventoryController.createInventoryTransactions';

const columns = [
    { label: 'Product Name', fieldName: 'productName' },
    { label: 'SKU', fieldName: 'sku' },
    { label: 'Current Stock', fieldName: 'currentStock', type: 'number' },
    { label: 'Quantity', fieldName: 'quantity', type: 'number', editable: true }
];

export default class BarcodeScanner extends LightningElement {
    @track scannedBarcode = '';
    @track selectedWarehouse;
    @track warehouseOptions = [];
    @track orderItems = [];
    @track columns = columns;
    @track draftValues = [];

    // Load warehouses on init
    @wire(getAllWarehouses)
    wiredWarehouses({ data, error }) {
        if (data) {
            this.warehouseOptions = data.map(wh => ({
                label: wh.Name + ' (' + wh.Location__c + ')',
                value: wh.Id
            }));
        } else if (error) {
            this.showToast('Error', 'Failed to load warehouses', 'error');
        }
    }

    handleWarehouseChange(event) {
        this.selectedWarehouse = event.detail.value;
    }

    handleBarcodeChange(event) {
        this.scannedBarcode = event.target.value;
    }

    // Add this new handler for saving draft values
    handleSave(event) {
        this.draftValues = event.detail.draftValues;
        
        // Convert draft values to regular items
        const updatedItems = JSON.parse(JSON.stringify(this.orderItems));
        
        // Apply changes from the draft values
        this.draftValues.forEach(draft => {
            const itemIndex = updatedItems.findIndex(item => item.id === draft.id);
            if (itemIndex >= 0) {
                updatedItems[itemIndex] = { ...updatedItems[itemIndex], ...draft };
            }
        });

        this.orderItems = updatedItems;
        this.draftValues = []; // Clear draft values after save
    }

    addToOrder() {
        if (!this.selectedWarehouse) {
            this.showToast('Error', 'Please select a warehouse first', 'error');
            return;
        }

        if (this.scannedBarcode) {
            getProductByBarcode({ 
                barcode: this.scannedBarcode,
                warehouseId: this.selectedWarehouse
            })
            .then(result => {
                if (result) {
                    const existingItem = this.orderItems.find(item => item.productId === result.product.Id);
                    
                    if (existingItem) {
                        existingItem.quantity += 1;
                        this.orderItems = [...this.orderItems]; // Trigger reactivity
                    } else {
                        this.orderItems = [...this.orderItems, {
                            id: this.orderItems.length + 1,
                            productId: result.product.Id,
                            productName: result.product.Name,
                            sku: result.product.ProductCode,
                            currentStock: result.inventory?.Current_Quantity__c || 0,
                            quantity: 1,
                            barcode: this.scannedBarcode
                        }];
                    }

                    this.scannedBarcode = '';
                    this.template.querySelector('.barcode-input').focus();
                }
            })
            .catch(error => {
                this.showToast('Error', error.body.message, 'error');
            });
        }
    }

    submitOrder() {
        if (this.orderItems.length === 0) {
            this.showToast('Error', 'No items to submit', 'error');
            return;
        }

        createInventoryTransaction({
            transactions: this.orderItems.map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                barcode: item.barcode
            })),
            transactionType: 'Out',
            warehouseId: this.selectedWarehouse
        })
        .then(() => {
            this.showToast('Success', 'Order submitted!', 'success');
            this.orderItems = [];
        })
        .catch(error => {
            this.showToast('Error', error.body.message, 'error');
        });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}