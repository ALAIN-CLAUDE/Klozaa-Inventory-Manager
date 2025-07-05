public with sharing class OrderQuoteController {

    /* ────────────────────────────────────────────────
       🔍 Account search (used in LWC on home page)
       ──────────────────────────────────────────────── */
    @AuraEnabled(cacheable=true)
    public static List<Account> searchAccounts(String keyword) {
        if (String.isBlank(keyword)) return new List<Account>();
        String kw = '%' + keyword + '%';
        return [
            SELECT Id, Name
            FROM   Account
            WHERE  RecordType.DeveloperName = 'Merchant'
            AND    Name LIKE :kw
            ORDER  BY Name
            LIMIT  20
        ];
    }

    /* ────────────────────────────────────────────────
       🔍 Product search (by name or product code)
       ──────────────────────────────────────────────── */
    @AuraEnabled(cacheable=true)
    public static List<Product2> searchProducts(String keyword) {
        if (String.isBlank(keyword)) return new List<Product2>();
        String likeKw = '%' + keyword + '%';
        return [
            SELECT Id, Name, ProductCode, Description
            FROM   Product2
            WHERE  IsActive = true
            AND   (Name LIKE :likeKw OR ProductCode LIKE :likeKw)
            ORDER BY Name
            LIMIT 30
        ];
    }

    /* ────────────────────────────────────────────────
       🧾 Cart wrapper sent from LWC
       ──────────────────────────────────────────────── */
    public class CartItem {
        @AuraEnabled public Id productId  { get; set;}
        @AuraEnabled public Decimal quantity  { get; set;}
    }

    /* ────────────────────────────────────────────────
       ✅ Create Quote and QuoteLineItems
       ──────────────────────────────────────────────── */
    @AuraEnabled
    public static Id createQuote(Id accountId, List<CartItem> items) {
        if (accountId == null)                    throw new AuraHandledException('Account is required');
        if (items == null || items.isEmpty())     throw new AuraHandledException('Cart is empty');

        /* Validate & collect Product IDs */
        Set<Id> prodIds = new Set<Id>();
        for (CartItem ci : items) {
            if (ci.productId == null || ci.quantity == null || ci.quantity <= 0) {
                throw new AuraHandledException('Each cart line needs a valid product and positive quantity');
            }
            prodIds.add(ci.productId);
        }

        /* 1️⃣  Re‑use or create Opportunity */
       Opportunity opp;
        List<Opportunity> oppList = [
            SELECT Id
            FROM   Opportunity
            WHERE  AccountId = :accountId AND IsClosed = false
            LIMIT  1
        ];

        if (!oppList.isEmpty()) {
            opp = oppList[0];
        } else {
            opp = new Opportunity(
                Name = 'Web Order Opportunity',
                CloseDate = Date.today().addMonths(1),
                StageName = 'Prospecting',
                AccountId = accountId
            );
            insert opp;
        }

        /* 2️⃣  Standard Pricebook */
        Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;

        /* 3️⃣  Query active PricebookEntries for those products */
        List<PricebookEntry> pbeList = [
            SELECT Id, UnitPrice, Product2Id
            FROM   PricebookEntry
            WHERE  Product2Id IN :prodIds
            AND    Pricebook2Id = :stdPbId
            AND    IsActive = true
        ];

        /* Build map keyed by Product2Id */
        Map<Id, PricebookEntry> pbeByProduct = new Map<Id, PricebookEntry>();
        for (PricebookEntry pbe : pbeList) {
            pbeByProduct.put(pbe.Product2Id, pbe);
        }

        if (pbeByProduct.size() != prodIds.size()) {
            throw new AuraHandledException('One or more products have no active price in the Standard Pricebook.');
        }

        /* 4️⃣  Create Quote */
        Quote qt = new Quote(
            Name           = 'Web Order – ' + DateTime.now().format('yyyy-MM-dd HH:mm'),
            OpportunityId  = opp.Id,
            Status         = 'Draft',
            Pricebook2Id   = stdPbId,
            ExpirationDate = Date.today().addDays(30)
        );
        insert qt;

        /* 5️⃣  QuoteLineItems */
        List<QuoteLineItem> lines = new List<QuoteLineItem>();
        for (CartItem ci : items) {
            PricebookEntry pbe = pbeByProduct.get(ci.productId);
            lines.add(new QuoteLineItem(
                QuoteId          = qt.Id,
                PricebookEntryId = pbe.Id,
                Quantity         = ci.quantity,
                UnitPrice        = pbe.UnitPrice
            ));
        }
        insert lines;

        return qt.Id;
    }
}
