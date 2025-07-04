public with sharing class InventoryController {

    /* ───────── existing helpers ───────── */
    @AuraEnabled(cacheable=true)
    public static List<Warehouse__c> getAllWarehouses() {
        return [SELECT Id, Name, Location__c FROM Warehouse__c ORDER BY Name];
    }

    @AuraEnabled(cacheable=true)
    public static List<ProductCategory> getProductCategories() {
        return [SELECT Id, Name FROM ProductCategory ORDER BY Name];
    }

   @AuraEnabled
public static ProductInventoryInfo getProductByBarcode(String barcode, String warehouseId) {
    // Fetch product
    List<Product2> prodList = [
        SELECT Id, Name, ProductCode 
        FROM Product2 
        WHERE ProductCode = :barcode 
        LIMIT 1
    ];
    
    if (prodList.isEmpty()) {
        throw new AuraHandledException('Product with Code '+barcode+ ' not found in catalogue');
    }
    Product2 prod = prodList[0];

    // Fetch inventory
    List<Inventory__c> invList = [
        SELECT Id, Current_Quantity__c, Previous_Quantity__c, Total_des_packs__c, Qty_per_pack__c
        FROM Inventory__c
        WHERE Product__c = :prod.Id AND Warehouse__c = :warehouseId
        LIMIT 1
    ];

    if (invList.isEmpty()) {
        throw new AuraHandledException('No inventory for this SKU in selected warehouse');
    }

    Inventory__c inv = invList[0];

    return new ProductInventoryInfo(prod, inv);
}


    public class ProductInventoryInfo {
        @AuraEnabled public Product2 product;
        @AuraEnabled public Inventory__c inventory;
        public ProductInventoryInfo(Product2 p, Inventory__c i) { product = p; inventory = i; }
    }

    @AuraEnabled(cacheable=true)
public static List<Account> getSuppliers() {
    return [
        SELECT Id, Name
        FROM   Account
        WHERE  RecordType.DeveloperName = 'Supplier'   // adjust if your record‑type name differs
        ORDER BY Name
    ];
}

    /* ------------------------------------------------------------------
       CREATE  Product + Inventory  + IN transaction
       ------------------------------------------------------------------*/
    @AuraEnabled
    public static Id createProductBundleFull(
        String sku,
        String name,
        String brand,
        Id categoryId,
        String uom,
        String size,
        String description,
        Id warehouseId,
        Decimal openingQty,
        Decimal unitPrice,
        Decimal qtyPerPack,
        Id supplierId,
        String sourceDoc
    ) {
        try {
            // 1. validation
            if (String.isBlank(sku) || String.isBlank(name) || String.isBlank(brand) ||
                categoryId == null  || String.isBlank(uom) || String.isBlank(size) ||
                warehouseId == null || openingQty == null || unitPrice == null ||
                qtyPerPack == null  || supplierId == null) {
                throw new AuraHandledException('Missing required fields');
            }

            // 2. prevent duplicate SKU
           // if (![SELECT Id FROM Product2 WHERE ProductCode = :sku LIMIT 1].isEmpty()) {
          //      throw new AuraHandledException('A product with this SKU already exists. Please use a different SKU.');
          //  }

            /* 3. Product */
            Product2 prod = new Product2(
                Name                   = name,
                ProductCode            = sku,
                Product_Brand__c       = brand,
                Qty_per_pack__c        = qtyPerPack,
                Category__c            = categoryId,
                QuantityUnitOfMeasure  = uom,
                Size__c                = Decimal.valueOf(size),
                Description            = description,
                IsActive               = true
            );
            insert prod;

            /* 4. PricebookEntry in Standard PB */
            Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
            insert new PricebookEntry(
                Product2Id   = prod.Id,
                Pricebook2Id = stdPbId,
                UnitPrice    = unitPrice,
                IsActive     = true
            );

            /* 5. Inventory record */
            Inventory__c inv = new Inventory__c(
                Product__c          = prod.Id,
                Warehouse__c        = warehouseId,
                Current_Quantity__c = openingQty,
                Previous_Quantity__c= 0,
                Supplier__c = supplierId,
                Source_Document__c   = sourceDoc,
                Last_Stock_Update__c= System.now()
            );
            insert inv;

            /* 6. IN transaction */
            insert new Inventory_Transaction__c(
                Product__c           = prod.Id,
                Warehouse__c         = warehouseId,
                Inventory__c         = inv.Id,
                Quantity__c          = openingQty,
                Previous_Quantity__c = 0,
                Movement_Type__c     = 'IN',
                Scanner_User__c      = UserInfo.getUserId(),
                Received_From__c     = supplierId,
                Source_Document__c   = sourceDoc,
                Transaction_Date__c = Date.today()
            );

            /* 7. refresh category total */
            refreshCategoryQuantity(categoryId);

            return prod.Id;

        } catch (DmlException e) {
            if (e.getMessage().contains('DUPLICATE_VALUE') && e.getMessage().contains('ProductCode')) {
                throw new AuraHandledException('A product with this SKU already exists. Please use a different SKU.');
            }
            throw new AuraHandledException('Error creating product: ' + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException('Error: ' + e.getMessage());
        }
    }

    /* ------------------------------------------------------------------
       UPDATE Inventory quantity AND refresh category total
       ------------------------------------------------------------------*/
    @AuraEnabled
    public static void updateInventoryQuantity(Id inventoryId, Decimal newQuantity,String  sourceDoc) {
        if (inventoryId == null || newQuantity == null || newQuantity < 0 || sourceDoc ==null) {
            throw new AuraHandledException('Invalid parameters');
        }

        Inventory__c inv = [
            SELECT Id, Current_Quantity__c, Product__r.Category__c,	Warehouse__c,Product__c, Supplier__c
            
            FROM   Inventory__c
            WHERE  Id = :inventoryId
            LIMIT  1
        ];

        Decimal prevQty   = inv.Current_Quantity__c == null ? 0 : inv.Current_Quantity__c;
        Decimal newQty    = newQuantity == null   ? 0 : newQuantity;
        Decimal diff      = newQty - prevQty;

        inv.Previous_Quantity__c = prevQty;
        inv.Current_Quantity__c  = newQty + prevQty;
        inv.Last_Stock_Update__c = System.now();
        inv.Source_Document__c   = sourceDoc;
        update inv;


          /* --- log Inventory_Transaction__c --- */
        if (diff != 0) {
            insert new Inventory_Transaction__c(
                Product__c           = inv.Product__c,
                Warehouse__c         = inv.Warehouse__c,
                Inventory__c         = inv.Id,
                Quantity__c          = newQty,
                Previous_Quantity__c = prevQty,
                Movement_Type__c     = 'IN UPDATED QTY',
                Scanner_User__c      = UserInfo.getUserId(),
                Received_From__c     = inv.Supplier__c,
                Source_Document__c   = sourceDoc,
                Transaction_Date__c = Date.today()
            );
        }
        // Re‑sum the category
        refreshCategoryQuantity(inv.Product__r.Category__c);
    }

    /* ------------------------------------------------------------------
       HELPER:  recalculate Category_Current_Quantity__c
       ------------------------------------------------------------------*/
    private static void refreshCategoryQuantity(Id categoryId) {
        if (categoryId == null) return;

        // Sum all Current_Quantity__c for inventories whose product is in this category
        AggregateResult ar = [
            SELECT SUM(Current_Quantity__c) total
            FROM   Inventory__c
            WHERE  Product__r.Category__c = :categoryId
        ];
        Decimal totalQty = (Decimal) ar.get('total');
        if (totalQty == null) totalQty = 0;

        ProductCategory catRec = [
            SELECT Id, Category_Current_Quantity__c
            FROM   ProductCategory
            WHERE  Id = :categoryId
            LIMIT  1
        ];
        catRec.Category_Current_Quantity__c = totalQty;
        update catRec;
    }
   
}
