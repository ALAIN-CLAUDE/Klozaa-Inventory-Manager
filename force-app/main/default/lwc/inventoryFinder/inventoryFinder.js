import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getAllWarehouses from '@salesforce/apex/InventoryController.getAllWarehouses';
import getProductByBarcode from '@salesforce/apex/InventoryController.getProductByBarcode';
import updateInventoryQuantity from '@salesforce/apex/InventoryController.updateInventoryQuantity';

const columns = [
    { label: 'Product Name (Nom du Produit)', fieldName: 'productName' },
    { label: 'SKU', fieldName: 'sku' },
    { label: 'Current Stock (Stock Actuel)', fieldName: 'currentStock', type: 'number' },
    { label: 'Previous Quantity (Quantité Précédente)', fieldName: 'previousQuantity', type: 'number' },
    { label: 'Qty per Pack (Qté par Pack)', fieldName: 'qtyPerPack', type: 'number' },
    { label: 'Total des Packs', fieldName: 'totalPacks', type: 'number' }
];

export default class FindOrUpdateInventory extends LightningElement {

    @track scannedBarcode = '';
    @track selectedWarehouse;
    @track warehouseOptions = [];
    @track orderItems = [];
    @track draftValues = [];
    @track noResult = false;
    @track isLoading = false;

    // For manual stock update
    @track selectedInventoryId = null;
    @track newCurrentStock = 0;
    @track isUpdating = false;

    columns = columns;

    /* ----------------  Initialization ---------------- */

    @wire(getAllWarehouses)
    wiredWarehouses({ data, error }) {
        if (data) {
            this.warehouseOptions = data.map(wh => ({
                label: `${wh.Name} (${wh.Location__c})`,
                value: wh.Id
            }));

            if (this.warehouseOptions.length === 1) {
                this.selectedWarehouse = this.warehouseOptions[0].value;
            }
        } else if (error) {
            this.showToast('Error', 'Failed to load warehouses', 'error');
        }
    }

    /* ----------------  Handlers  ---------------- */

    handleWarehouseChange(event) {
        this.selectedWarehouse = event.detail.value;
    }

    handleBarcodeChange(event) {
        this.scannedBarcode = event.target.value;
    }

    handleSave(event) {
        const updates = event.detail.draftValues;
        const items = [...this.orderItems];

        updates.forEach(draft => {
            const idx = items.findIndex(i => i.id === draft.id);
            if (idx > -1) items[idx] = { ...items[idx], ...draft };
        });

        this.orderItems = items;
        this.draftValues = [];
        this.showToast('Success', 'Quantities updated', 'success');
    }

 SearchInventory() {
    this.noResult = false;
    const sku = this.scannedBarcode?.trim();

    if (!this.selectedWarehouse) {
        this.showToast('Error', 'Please select a warehouse first', 'error');
        return;
    }
    if (!sku) {
        this.showToast('Error', 'Please scan or type a SKU', 'error');
        return;
    }

    this.isLoading = true;

    getProductByBarcode({ barcode: sku, warehouseId: this.selectedWarehouse })
        .then(result => {
            const inv = result.inventory;
            const prod = result.product;

            const idx = this.orderItems.findIndex(i => i.productId === prod.Id);

            const newRow = {
                id: idx > -1 ? this.orderItems[idx].id : this.orderItems.length + 1,
                productId:      prod.Id,
                inventoryId:    inv.Id,
                productName:    prod.Name,
                sku:            prod.ProductCode,
                currentStock:   inv.Current_Quantity__c,
                previousQuantity: inv.Previous_Quantity__c,
                qtyPerPack:     inv.Qty_per_pack__c,
                totalPacks:     inv.Total_des_packs__c,
                barcode:        sku
            };

            if (idx > -1) {
                // 🔁  overwrite existing row
                this.orderItems.splice(idx, 1, newRow);
                this.orderItems = [...this.orderItems];   // trigger re-render
            } else {
                // ➕  add new row
                this.orderItems = [...this.orderItems, newRow];
            }

            this.showToast('Success', `${prod.Name} refreshed`, 'success');
            this.scannedBarcode = '';
            this.template.querySelector('.barcode-input').focus();
        })
        .catch(error => {
            const msg = error?.body?.message || error.message || 'Unknown error';
            this.noResult = true;
            this.showToast('Error', msg, 'error');
        })
        .finally(() => {
            this.isLoading = false;
        });
}


    handleRowSelection(event) {
        const rows = event.detail.selectedRows;
        if (rows && rows.length) {
            const row = rows[0];
            this.selectedInventoryId = row.inventoryId;
            this.newCurrentStock = row.currentStock;
        } else {
            this.selectedInventoryId = null;
        }
    }

    handleNewStockChange(event) {
        this.newCurrentStock = Number(event.target.value);
    }

 updateCurrentStock() {
    if (!this.selectedInventoryId) {
        this.showToast('Error', 'Select a row first', 'error');
        return;
    }

    if (isNaN(this.newCurrentStock) || this.newCurrentStock < 0) {
        this.showToast('Error', 'Enter a valid non‑negative number', 'error');
        return;
    }

    this.isUpdating = true;

    updateInventoryQuantity({
        inventoryId: this.selectedInventoryId,
        newQuantity: this.newCurrentStock
    })
        .then(() => {
            // Refresh the record from server to get updated formula field
            const targetRow = this.orderItems.find(row => row.inventoryId === this.selectedInventoryId);
            if (!targetRow) return;

            return getProductByBarcode({
                barcode: targetRow.sku,
                warehouseId: this.selectedWarehouse
            }).then(result => {
                const inv = result.inventory;

                this.orderItems = this.orderItems.map(row =>
                    row.inventoryId === this.selectedInventoryId
                        ? {
                            ...row,
                            currentStock: inv.Current_Quantity__c,
                            previousQuantity: inv.Previous_Quantity__c,
                            totalPacks: inv.Total_des_packs__c
                        }
                        : row
                );
            });
        })
        .then(() => {
            this.showToast('Success', 'Stock mis à jour avec succès', 'success');
        })
        .catch(err => {
            const msg = err?.body?.message || err.message || 'Unknown error';
            this.showToast('Error', msg, 'error');
        })
        .finally(() => {
            this.isUpdating = false;
        });
}

    /* ----------------  Utility ---------------- */

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    get hasItems() {
    return this.orderItems && this.orderItems.length > 0;
}

}
