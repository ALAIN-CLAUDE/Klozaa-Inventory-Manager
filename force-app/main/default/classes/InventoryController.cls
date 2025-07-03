public with sharing class InventoryController {

    @AuraEnabled(cacheable=true)
    public static List<Warehouse__c> getAllWarehouses() {
        return [SELECT Id, Name, Location__c FROM Warehouse__c ORDER BY Name];
    }

    @AuraEnabled
    public static ProductInventoryInfo getProductByBarcode(String barcode, String warehouseId) {
        try {
            Product2 product = [
                SELECT Id, Name, ProductCode, Category__r.Name, Brand__r.Name, 
                       Size__c, Unit_of_Measure__c
                FROM Product2 
                WHERE ProductCode = :barcode
                LIMIT 1
            ];

            if (product == null) {
                throw new AuraHandledException('Product(s) not found');
            }

            List<Inventory__c> inventoryList = [
                SELECT Id, Current_Quantity__c, Previous_Quantity__c,
                       Qty_per_pack__c, Total_des_packs__c
                FROM Inventory__c
                WHERE Product__c = :product.Id 
                AND Warehouse__c = :warehouseId
                LIMIT 1
            ];

            Inventory__c inventory = inventoryList.isEmpty() ? null : inventoryList[0];

            if (inventory == null) {
                throw new AuraHandledException(
                    'No inventory for this SKU in the selected warehouse. Please create an Inventory record first.'
                );
            }

            return new ProductInventoryInfo(product, inventory);

        } catch (Exception e) {
            throw new AuraHandledException('Error: ' + e.getMessage());
        }
    }

    public class ProductInventoryInfo {
        @AuraEnabled public Product2 product;
        @AuraEnabled public Inventory__c inventory;

        public ProductInventoryInfo(Product2 prod, Inventory__c inv) {
            this.product = prod;
            this.inventory = inv;
        }
    }

    @AuraEnabled
    public static void updateInventoryQuantity(Id inventoryId, Decimal newQuantity) {
        if (inventoryId == null) {
            throw new AuraHandledException('Inventory Id is required');
        }
        if (newQuantity == null || newQuantity < 0) {
            throw new AuraHandledException('New quantity must be zero or positive');
        }

        try {
            Inventory__c inv = [
                SELECT Id, Current_Quantity__c, Previous_Quantity__c, Qty_per_pack__c ,Total_des_packs__c
                FROM Inventory__c
                WHERE Id = :inventoryId
                LIMIT 1
            ];
            inv.Previous_Quantity__c = inv.Current_Quantity__c;
            inv.Current_Quantity__c = newQuantity;
            inv.Last_Stock_Update__c = System.now();
            update inv;
        } catch (Exception e) {
            throw new AuraHandledException('Unable to update inventory: ' + e.getMessage());
        }
    }

    /**
 * Creates Product2 + Standard PricebookEntry + Inventory + IN Transaction
 */
@AuraEnabled
public static Id createProductBundle(String sku, String name, Id warehouseId, Decimal openingQty) {
    if (String.isBlank(sku) || String.isBlank(name) || warehouseId == null) {
        throw new AuraHandledException('SKU, Name and Warehouse are required');
    }

    // 1. Product
    Product2 p = new Product2(
        Name = name,
        ProductCode = sku,
        IsActive = true
    );
    insert p;

    // 2. Standard PricebookEntry (Price = 0 by default)
    Id stdPBId = Pricebook2.getStandardPricebookId();
    PricebookEntry pbe = new PricebookEntry(
        Product2Id = p.Id,
        Pricebook2Id = stdPBId,
        UnitPrice = 0,
        IsActive = true
    );
    insert pbe;

    // 3. Inventory
    Inventory__c inv = new Inventory__c(
        Product__c = p.Id,
        Warehouse__c = warehouseId,
        Current_Quantity__c = openingQty,
        Previous_Quantity__c = 0
    );
    insert inv;

    // 4. IN Transaction
    Inventory_Transaction__c txn = new Inventory_Transaction__c(
        Product__c      = p.Id,
        Warehouse__c    = warehouseId,
        Type__c         = 'IN',
        Quantity__c     = openingQty,
        Related_Product_Creation__c = true // optional custom checkbox
    );
    insert txn;

    return p.Id;
}

}
