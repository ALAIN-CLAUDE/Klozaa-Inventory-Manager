import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

/* Apex */
import getAllWarehouses     from '@salesforce/apex/InventoryController.getAllWarehouses';
import getProductByBarcode  from '@salesforce/apex/InventoryController.getProductByBarcode';
import updateInventoryQty   from '@salesforce/apex/InventoryController.updateInventoryQuantity';
import getProductCategories from '@salesforce/apex/InventoryController.getProductCategories';
import getSuppliers         from '@salesforce/apex/InventoryController.getSuppliers';
import createProductBundle  from '@salesforce/apex/InventoryController.createProductBundleFull';

/* Picklist meta */
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import PRODUCT_OBJECT  from '@salesforce/schema/Product2';
import BRAND_FIELD     from '@salesforce/schema/Product2.Product_Brand__c';
import UOM_FIELD       from '@salesforce/schema/Product2.QuantityUnitOfMeasure';

/* Datatable columns */
const columns = [
    { label: 'Product Name', fieldName: 'productName' },
    { label: 'SKU', fieldName: 'sku' },
    { label: 'Current Stock', fieldName: 'currentStock', type: 'number' },
    { label: 'Previous Qty', fieldName: 'previousQuantity', type: 'number' },
    { label: 'UoM', fieldName: 'qtyPerPack', type: 'number' },
    { label: 'Total Packs/Container', fieldName: 'totalPacks', type: 'number' }
];

export default class FindOrUpdateInventory extends LightningElement {
    /* scan & search */
    @track scannedBarcode = '';
    @track isLoading = false;
    @track noResult = false;

    /* warehouse */
    @track warehouseOptions = [];
    selectedWarehouse;

    /* datatable */
    columns = columns;
    @track orderItems = [];
    @track draftValues = [];
    @track selectedInventoryId = null;
    @track newCurrentStock = 0;
    @track isUpdating = false;

    /* not-found flow */
    @track showAddPrompt = false;
    @track showNewProductModal = false;

    /* new product fields */
    @track newProdName = '';
    @track openingQty = 0;
    @track unitPrice = 0;
    @track qtyPerPack = 0;
    @track newBrand = '';
    @track newCategoryId = '';
    @track newUom = '';
    @track newSize = '';
    @track description = '';
    @track supplierId = '';  // ← NEW
    @track sourceDoc = '';

    /* picklist / lookup options */
    @track brandOptions = [];
    @track categoryOptions = [];
    @track uomOptions = [];
    @track supplierOptions = [];  // ← NEW
    @track sourceDocUpdate = ''; 

    /* Wires */
    @wire(getAllWarehouses)
    wiredWarehouses({ data, error }) {
        if (data) {
            this.warehouseOptions = data.map(w => ({ label: `${w.Name} (${w.Location__c})`, value: w.Id }));
            if (this.warehouseOptions.length === 1) {
                this.selectedWarehouse = this.warehouseOptions[0].value;
            }
        } else if (error) {
            this.showToast('Error', 'Warehouse load failed', 'error');
        }
    }

    @wire(getObjectInfo, { objectApiName: PRODUCT_OBJECT }) objectInfo;
    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: BRAND_FIELD })
    wiredBrand({ data }) {
        if (data) this.brandOptions = data.values.map(v => ({ label: v.label, value: v.value }));
    }
    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: UOM_FIELD })
    wiredUom({ data }) {
        if (data) this.uomOptions = data.values.map(v => ({ label: v.label, value: v.value }));
    }

    @wire(getProductCategories)
    wiredCats({ data }) {
        if (data) this.categoryOptions = data.map(c => ({ label: c.Name, value: c.Id }));
    }

    @wire(getSuppliers)
    wiredSuppliers({ data }) {
        if (data) this.supplierOptions = data.map(acc => ({ label: acc.Name, value: acc.Id }));
    }

    /* Input handlers */     

    handleSourceDocUpdateChange = e => {  // NEW
        this.sourceDocUpdate = e.target.value;
    };

    handleWarehouseChange = e => this.selectedWarehouse = e.detail.value;
    handleBarcodeChange = e => this.scannedBarcode = e.target.value;
    handleSave = () => { this.draftValues = []; };
    handleRowSelection = e => {
        const rows = e.detail.selectedRows;
        if (rows && rows.length) {
            this.selectedInventoryId = rows[0].inventoryId;
            this.newCurrentStock = rows[0].currentStock;
        } else {
            this.selectedInventoryId = null;
        }
    };
    handleNewStockChange = e => this.newCurrentStock = Number(e.target.value);

    handleInput = e => this.newProdName = e.target.value;
    handleBrand = e => this.newBrand = e.detail.value;
    handleCategory = e => this.newCategoryId = e.detail.value;
    handleUom = e => this.newUom = e.detail.value;
    handleSize = e => this.newSize = e.target.value;
    handleQty = e => this.openingQty = Number(e.target.value);
    handleUnitPriceChange = e => this.unitPrice = Number(e.target.value);
    handleQuantityPerPackChange = e => this.qtyPerPack = Number(e.target.value);
    handleDesc = e => this.description = e.target.value;
    handleSupplier = e => this.supplierId = e.detail.value;
    handleSourceDocChange = e => this.sourceDoc = e.target.value;

    /* Search by SKU */
    SearchInventory() {
        this.showAddPrompt = false;
        this.noResult = false;
        const sku = this.scannedBarcode.trim();
        if (!sku || !this.selectedWarehouse) {
            this.showToast('Error', 'Select warehouse and enter SKU', 'error'); return;
        }

        this.isLoading = true;
        getProductByBarcode({ barcode: sku, warehouseId: this.selectedWarehouse })
        .then(res => {
            const { inventory: inv, product: prod } = res;
            const idx = this.orderItems.findIndex(i => i.productId === prod.Id);
            const newRow = {
                id: idx > -1 ? this.orderItems[idx].id : this.orderItems.length + 1,
                productId: prod.Id,
                inventoryId: inv.Id,
                productName: prod.Name,
                sku: prod.ProductCode,
                currentStock: inv.Current_Quantity__c,
                previousQuantity: inv.Previous_Quantity__c,
                qtyPerPack: inv.Qty_per_pack__c,
                totalPacks: inv.Total_des_packs__c,
                barcode: sku
            };
            if (idx > -1) this.orderItems.splice(idx, 1, newRow);
            else this.orderItems.push(newRow);
            this.orderItems = [...this.orderItems];
            this.showToast('Success', `${prod.Name} in catalogue`, 'success');
        })
        .catch(err => {
            this.showAddPrompt = true;
            this.noResult = false;
            const msg = err?.body?.message || err.message || 'Unknown error';
            this.showToast('Error', msg, 'error');
        })
        .finally(() => this.isLoading = false);
    }

    /* Update Inventory */
    updateCurrentStock() {
        if (!this.selectedInventoryId) return;
        this.isUpdating = true;
        updateInventoryQty({ inventoryId: this.selectedInventoryId, newQuantity: this.newCurrentStock, sourceDoc   : this.sourceDocUpdate })
        .then(() => {
            const row = this.orderItems.find(r => r.inventoryId === this.selectedInventoryId);
            if (!row) return;
            return getProductByBarcode({ barcode: row.sku, warehouseId: this.selectedWarehouse })
            .then(res => {
                const inv = res.inventory;
                this.orderItems = this.orderItems.map(r =>
                    r.inventoryId === row.inventoryId
                        ? {
                            ...r,
                            currentStock: inv.Current_Quantity__c,
                            previousQuantity: inv.Previous_Quantity__c,
                            totalPacks: inv.Total_des_packs__c
                        }
                        : r
                );
            });
        })
        .then(() => this.showToast('Success', 'Stock updated', 'success'))
        .catch(e => this.showToast('Error', e?.body?.message || e.message, 'error'))
        .finally(() => this.isUpdating = false);
    }

    /* Modal control */
    openNewProductModal = () => { this.showAddPrompt = false; this.showNewProductModal = true; };
    closeModal = () => {
        this.showNewProductModal = false;
        this.supplierId = ''; // reset supplier field
    };
    cancelAddPrompt = () => { this.showAddPrompt = false; };

    /* Create product + inventory */
    createProduct() {
        if (!this.newProdName || !this.newBrand || !this.newCategoryId || !this.newUom ||
            !this.newSize || !this.supplierId) {
            this.showToast('Error', 'Complete all required fields (*)', 'error'); return;
        }

        this.isLoading = true;
        createProductBundle({
            sku: this.scannedBarcode.trim(),
            name: this.newProdName.trim(),
            brand: this.newBrand,
            categoryId: this.newCategoryId,
            uom: this.newUom,
            size: this.newSize,
            description: this.description,
            warehouseId: this.selectedWarehouse,
            openingQty: this.openingQty || 0,
            unitPrice: this.unitPrice || 0,
            qtyPerPack: this.qtyPerPack || 0,
            supplierId: this.supplierId,    // ← pass supplier to Apex
            sourceDoc:this.sourceDoc
        })
        .then(() => {
            this.showToast('Success', 'Product created', 'success');
            this.closeModal();
            this.SearchInventory();
        })
        .catch(e => this.showToast('Error', e?.body?.message || e.message, 'error'))
        .finally(() => this.isLoading = false);
    }

    /* Utility */
    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    get hasItems() {
        return this.orderItems && this.orderItems.length > 0;
    }
}
