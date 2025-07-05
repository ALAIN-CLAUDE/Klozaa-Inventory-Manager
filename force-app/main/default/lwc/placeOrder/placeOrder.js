import { LightningElement, track } from 'lwc';
import searchAccounts from '@salesforce/apex/OrderQuoteController.searchAccounts';
import searchProducts from '@salesforce/apex/OrderQuoteController.searchProducts';
import createQuote from '@salesforce/apex/OrderQuoteController.createQuote';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class PlaceOrderQuote extends LightningElement {
    // Account search
    @track acctKeyword = '';
    @track acctResults = [];
    @track noAcctFound = false;
    @track accountId = null;
    @track selectedAcctName = '';

    // Product search
    @track prodKeyword = '';
    @track prodResults = [];

    // Cart
    @track cart = [];
    @track draftValues = [];
    isBusy = false;

    // Product result columns
    prodColumns = [
        { label: 'Name', fieldName: 'Name' },
        { label: 'SKU', fieldName: 'ProductCode' },
        { label: 'Description', fieldName: 'Description' },
        {
            type: 'button',
            typeAttributes: {
                label: 'Add to Cart',
                name: 'addToCart',
                variant: 'brand'
            }
        }
    ];

    // Cart columns
    cartColumns = [
        { label: 'Name', fieldName: 'name' },
        { label: 'SKU', fieldName: 'sku' },
        {
            label: 'Quantity',
            fieldName: 'quantity',
            type: 'number',
            editable: true
        }
    ];

    // Handle account search input
    handleAcctKeyword = (e) => {
        this.acctKeyword = e.target.value.trim();
        if (!this.acctKeyword) {
            this.acctResults = [];
            this.noAcctFound = false;
            return;
        }

        searchAccounts({ keyword: this.acctKeyword })
            .then(res => {
                this.acctResults = res;
                this.noAcctFound = res.length === 0;
            })
            .catch(() => {
                this.acctResults = [];
                this.noAcctFound = true;
            });
    };

    // Handle account selection from results
    handleAcctPick = (e) => {
        const acctId = e.currentTarget.dataset.id;
        const acctName = e.currentTarget.dataset.name;
        this.accountId = acctId;
        this.selectedAcctName = acctName;
        this.acctResults = [];
        this.noAcctFound = false;
    };

    // Handle product search
    handleProdKeyword = (e) => {
        this.prodKeyword = e.target.value.trim();
        if (!this.prodKeyword) return;

        searchProducts({ keyword: this.prodKeyword })
            .then(res => this.prodResults = res)
            .catch(() => this.prodResults = []);
    };

    // Add product to cart or increment if exists
    addToCart = (e) => {
        const row = e.detail.row;
        const idx = this.cart.findIndex(c => c.productId === row.Id);

        if (idx > -1) {
            this.cart[idx].quantity += 1; // increment
        } else {
            this.cart.push({
                productId: row.Id,
                name: row.Name,
                sku: row.ProductCode,
                quantity: 1
            });
        }
        this.cart = [...this.cart];
    };

    // Save cart quantity edits
    saveDrafts = (e) => {
        const updates = e.detail.draftValues;

        updates.forEach(dv => {
            const row = this.cart.find(c => c.productId === dv.productId);
            if (row) {
                const q = Number(dv.quantity);
                if (isNaN(q) || q <= 0) {
                    this.toast('Error', 'Quantity must be a positive number', 'error');
                } else {
                    row.quantity = q;
                }
            }
        });

        this.cart = [...this.cart];
        this.draftValues = [];
    };

    // Place quote
    placeOrder = () => {
        console.log('this.cart.length----> ',JSON.stringify(this.cart));
        console.log('this.draftValues---> ',JSON.stringify(this.draftValues));
        if (!this.accountId || this.cart.length === 0) {
            this.toast('Missing Info', 'Select a customer and add products to cart.', 'error');
            return;
        }

        const items = this.cart
            .filter(p => p.quantity && p.quantity > 0)
            .map(p => ({
                productId: p.productId,
                quantity: p.quantity
            }));
            
        if (items.length === 0) {
            this.toast('Error', 'All cart quantities are invalid or zero.', 'error');
            return;
        }

        this.isBusy = true;
         console.log('items111----> ',JSON.stringify(items));
        createQuote({ accountId: this.accountId, items })
            .then(() => {
                this.toast('Quote Created', 'Your order was placed successfully.', 'success');
                this.resetUI();
            })
            .catch(e => {
                this.toast('Error', e?.body?.message || e.message, 'error');
            })
            .finally(() => this.isBusy = false);
    };

    // Reset UI
    resetUI() {
        this.acctKeyword = '';
        this.prodKeyword = '';
        this.acctResults = [];
        this.prodResults = [];
        this.accountId = null;
        this.selectedAcctName = '';
        this.cart = [];
        this.draftValues = [];
    }

    // Disable place button if no account or empty cart
    get isPlaceDisabled() {
        return !this.accountId || this.cart.length === 0;
    }

    // Toast utility
    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
