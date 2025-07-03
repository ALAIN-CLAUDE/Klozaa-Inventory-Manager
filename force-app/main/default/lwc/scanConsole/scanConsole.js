import { LightningElement, track } from 'lwc';
import scanProduct from '@salesforce/apex/ScanController.scanProduct';
import publishMovement from '@salesforce/apex/ScanController.publishMovement';

export default class ScanConsole extends LightningElement {
    @track barcode = '';
    @track quantity = 1;
    @track type = 'Inbound';
    @track productName = '';

    get typeOptions() {
        return [
            { label: 'Inbound', value: 'Inbound' },
            { label: 'Outbound', value: 'Outbound' },
            { label: 'Adjustment', value: 'Adjustment' },
        ];
    }

    handleBarcodeChange(event) {
        this.barcode = event.target.value;
    }

    handleQtyChange(event) {
        this.quantity = parseInt(event.target.value);
    }

    handleTypeChange(event) {
        this.type = event.detail.value;
    }

    async handleSubmit() {
        const product = await scanProduct({ barcode: this.barcode });
        this.productName = product.Name;
        await publishMovement({
            productId: product.Id,
            warehouseId: 'a09WU00000A0a7NYAR', // replace with dynamic ID or UI lookup
            qty: this.quantity,
            type: this.type
        });
        alert('Stock movement submitted!');
    }
}