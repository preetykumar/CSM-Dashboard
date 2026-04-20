import axios, { AxiosInstance } from "axios";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

// Support both client credentials (sandbox) and JWT (production) auth
interface SalesforceConfigBase {
  loginUrl: string; // e.g., https://login.salesforce.com for production
}

interface ClientCredentialsConfig extends SalesforceConfigBase {
  authType: "client_credentials";
  clientId: string;
  clientSecret: string;
}

interface JWTConfig extends SalesforceConfigBase {
  authType: "jwt";
  clientId: string; // Consumer Key
  username: string; // SF username
  privateKeyPath?: string; // Path to PEM file (for local dev)
  privateKey?: string; // Direct PEM content (for Cloud Run)
}

export type SalesforceConfig = ClientCredentialsConfig | JWTConfig;

interface TokenResponse {
  access_token: string;
  instance_url: string;
  token_type: string;
  issued_at: string;
}

interface SFAccount {
  Id: string;
  Name: string;
  Customer_Success_Manager_csm__c?: string;
  Customer_Success_Manager_csm__r?: {
    Id: string;
    Name: string;
    Email: string;
  };
  Project_Manager__c?: string;
  Project_Manager__r?: {
    Id: string;
    Name: string;
    Email: string;
  };
  Engagement_Manager__c?: string;
  Engagement_Manager__r?: {
    Id: string;
    Name: string;
    Email: string;
  };
  Engagement_Manager2__c?: string;
  Engagement_Manager2__r?: {
    Id: string;
    Name: string;
    Email: string;
  };
  OwnerId?: string;
  Owner?: {
    Id: string;
    Name: string;
    Email: string;
  };
}

interface SFAccountWithParent {
  Id: string;
  Name: string;
  ParentId: string | null;
  Parent?: {
    Id: string;
    Name: string;
  };
}

export interface AccountHierarchyEntry {
  accountId: string;
  accountName: string;
  parentId: string | null;
  parentName: string | null;
  ultimateParentId: string;
  ultimateParentName: string;
}

interface SFUser {
  Id: string;
  Name: string;
  Email: string;
}

export interface CSMAssignment {
  accountId: string;
  accountName: string;
  csmId: string;
  csmName: string;
  csmEmail: string;
}

export interface PMAssignment {
  accountId: string;
  accountName: string;
  pmId: string;
  pmName: string;
  pmEmail: string;
}

export interface EnterpriseSubscription {
  id: string;
  name: string;
  accountId: string;
  productType: string;
  licenseCount: number;
  assignedSeats: number;
  percentageAssigned: number;
  environment: string;
  type: string;
  startDate: string;
  endDate: string;
  monitorPageCount?: number;
  monitorProjectCount?: number;
  enterpriseUuid?: string;
  enterpriseDomain?: string;
}

export interface RenewalOpportunity {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  amount: number;
  stageName: string;
  renewalDate: string;
  type: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  createdDate: string;
  lastModifiedDate: string;
  productName?: string;
  contactName?: string;
  contactEmail?: string;
  // CSM from Account's Customer Success Manager field
  csmName?: string;
  csmEmail?: string;
  // PRS from Account's Product Retention Specialist field
  prsId?: string;
  prsName?: string;
  prsEmail?: string;
  // Additional renewal fields
  renewalStatus?: string;
  accountingRenewalStatus?: string;
  poRequired?: boolean;
  poReceivedDate?: string;
  atRisk?: boolean;
  r6Notes?: string;
  r3Notes?: string;
  accountingNotes?: string;
  leadershipNotes?: string;
  leadershipRiskStatus?: string;
}

// Product Success object from Salesforce
interface SFProductSuccess {
  Id: string;
  Name: string;
  Account__c: string;
  Account__r?: {
    Id: string;
    Name: string;
  };
  Product_Retention_Specialist__c?: string;
  Product_Retention_Specialist__r?: {
    Id: string;
    Name: string;
    Email: string;
  };
}

export interface PRSAssignment {
  accountId: string;
  accountName: string;
  prsId: string;
  prsName: string;
  prsEmail: string;
}

interface SFOpportunity {
  Id: string;
  Name: string;
  AccountId: string;
  Account: {
    Id: string;
    Name: string;
    // CSM field on Account
    Customer_Success_Manager_csm__r?: {
      Name: string;
      Email: string;
    };
    // PRS field on Account (labeled "Product Retention Specialist" but API name is Customer_Success_Specialist__c)
    Customer_Success_Specialist__c?: string;
    Customer_Success_Specialist__r?: {
      Id: string;
      Name: string;
      Email: string;
    };
  };
  Amount: number;
  StageName: string;
  CloseDate: string;
  Type: string;
  OwnerId: string;
  Owner: {
    Id: string;
    Name: string;
    Email: string;
  };
  CreatedDate: string;
  LastModifiedDate: string;
  // Custom fields that may exist
  Product_Name__c?: string;
  Contact_Name__c?: string;
  Contact_Email__c?: string;
  // PRS field directly on Opportunity (string type, not a reference)
  Product_Retention_Specialist__c?: string;
  // Additional renewal fields
  Customer_Success_Renewal_Status__c?: string;  // labeled "Renewal Status"
  Renewal_Status__c?: string;  // labeled "Accounting Renewal Status"
  PO_Required__c?: boolean;
  PO_Received_Date__c?: string;
  Renewal_Status_1__c?: string;  // labeled "R6 Notes"
  Customer_Success_Next_Steps__c?: string;  // labeled "R3 Notes"
  Accounting_Notes_for_Renewal__c?: string;  // labeled "Accounting Notes for Renewal"
  Leadership_Notes__c?: string;  // labeled "Leadership Notes"
  Leadership_Risk_Status__c?: string;  // labeled "Leadership Risk Status" (picklist)
  // Child relationship: OpportunityContactRoles
  OpportunityContactRoles?: {
    records: Array<{
      ContactId: string;
      Contact: { Name: string; Email: string };
      Role: string;
      IsPrimary: boolean;
    }>;
  };
}

interface SFEnterpriseSubscription {
  Id: string;
  Name: string;
  Account__c: string;
  Product_Type__c: string;
  License_Count__c: number;
  Assigned_Seats__c: number;
  Percentage_Assigned__c: number;
  Environment__c: string;
  Type__c: string;
  Start_Date__c: string;
  End_Date__c: string;
  Monitor_Page_Count__c?: number;
  Monitor_Project_Count__c?: number;
  Enterprise_UUID__c?: string;
  Enterprise_Domain__c?: string;
}

export class SalesforceService {
  private config: SalesforceConfig;
  private accessToken: string | null = null;
  private instanceUrl: string | null = null;
  private tokenExpiry: Date | null = null;
  private client: AxiosInstance;

  constructor(config: SalesforceConfig) {
    this.config = config;
    this.client = axios.create({
      timeout: 30000,
    });
  }

  private async authenticate(): Promise<void> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return;
    }

    console.log(`Authenticating with Salesforce (${this.config.authType})...`);

    const params = new URLSearchParams();

    if (this.config.authType === "jwt") {
      // JWT Bearer Flow
      const assertion = this.createJWTAssertion();
      params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
      params.append("assertion", assertion);
    } else {
      // Client Credentials Flow (sandbox)
      params.append("grant_type", "client_credentials");
      params.append("client_id", this.config.clientId);
      params.append("client_secret", this.config.clientSecret);
    }

    try {
      const response = await this.client.post<TokenResponse>(
        `${this.config.loginUrl}/services/oauth2/token`,
        params,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.instanceUrl = response.data.instance_url;
      // Token typically lasts 2 hours, refresh after 1.5 hours
      this.tokenExpiry = new Date(Date.now() + 90 * 60 * 1000);

      console.log(`Authenticated with Salesforce: ${this.instanceUrl}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Salesforce auth error:", error.response?.data);
        throw new Error(`Salesforce authentication failed: ${error.response?.data?.error_description || error.message}`);
      }
      throw error;
    }
  }

  private createJWTAssertion(): string {
    if (this.config.authType !== "jwt") {
      throw new Error("JWT assertion requires JWT config");
    }

    // Get private key - either directly from config or from file
    let privateKey: string;
    if (this.config.privateKey) {
      // Use direct key content (for Cloud Run)
      privateKey = this.config.privateKey;
    } else if (this.config.privateKeyPath) {
      // Read from file (for local dev)
      const privateKeyPath = path.resolve(this.config.privateKeyPath);
      if (!fs.existsSync(privateKeyPath)) {
        throw new Error(`Private key file not found: ${privateKeyPath}`);
      }
      privateKey = fs.readFileSync(privateKeyPath, "utf8");
    } else {
      throw new Error("JWT config requires either privateKey or privateKeyPath");
    }

    // Create JWT claims
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.config.clientId, // Consumer Key
      sub: this.config.username, // SF username
      aud: this.config.loginUrl, // Login URL
      exp: now + 300, // 5 minutes expiry
    };

    // Sign and return JWT
    return jwt.sign(claims, privateKey, { algorithm: "RS256" });
  }

  private async apiCall<T>(method: "get" | "post", endpoint: string, data?: any): Promise<T> {
    await this.authenticate();

    const url = `${this.instanceUrl}${endpoint}`;

    try {
      const response = await this.client.request<T>({
        method,
        url,
        data,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Salesforce API error [${endpoint}]:`, error.response?.data);
        throw new Error(`Salesforce API call failed: ${error.response?.data?.[0]?.message || error.message}`);
      }
      throw error;
    }
  }

  async query<T>(soql: string): Promise<T[]> {
    const encodedQuery = encodeURIComponent(soql);
    const result = await this.apiCall<{ records: T[] }>("get", `/services/data/v59.0/query?q=${encodedQuery}`);
    return result.records;
  }

  // Query with automatic pagination for large result sets (>2000 records)
  async queryAll<T>(soql: string): Promise<T[]> {
    const encodedQuery = encodeURIComponent(soql);
    const firstPage = await this.apiCall<{ records: T[]; done: boolean; nextRecordsUrl?: string }>(
      "get", `/services/data/v59.0/query?q=${encodedQuery}`
    );

    const allRecords = [...firstPage.records];
    let nextUrl = firstPage.nextRecordsUrl;

    while (nextUrl) {
      const nextPage = await this.apiCall<{ records: T[]; done: boolean; nextRecordsUrl?: string }>(
        "get", nextUrl
      );
      allRecords.push(...nextPage.records);
      nextUrl = nextPage.nextRecordsUrl;
    }

    return allRecords;
  }

  async describeObject(objectName: string): Promise<any> {
    return this.apiCall("get", `/services/data/v59.0/sobjects/${objectName}/describe`);
  }

  async listObjects(filter?: string): Promise<Array<{ name: string; label: string; custom: boolean }>> {
    console.log("Listing Salesforce objects...");
    const result = await this.apiCall<{ sobjects: Array<{ name: string; label: string; custom: boolean }> }>(
      "get",
      "/services/data/v59.0/sobjects"
    );

    let objects = result.sobjects.map((obj) => ({
      name: obj.name,
      label: obj.label,
      custom: obj.custom,
    }));

    // Filter by name if provided
    if (filter) {
      const filterLower = filter.toLowerCase();
      objects = objects.filter(
        (obj) =>
          obj.name.toLowerCase().includes(filterLower) ||
          obj.label.toLowerCase().includes(filterLower)
      );
    }

    return objects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCSMAssignments(): Promise<CSMAssignment[]> {
    console.log("Fetching CSM assignments from Salesforce...");

    // Query accounts with CSM assignment using the Customer_Success_Manager_csm__c field
    try {
      const accounts = await this.query<SFAccount>(`
        SELECT Id, Name, Customer_Success_Manager_csm__c, Customer_Success_Manager_csm__r.Id,
               Customer_Success_Manager_csm__r.Name, Customer_Success_Manager_csm__r.Email
        FROM Account
        WHERE Customer_Success_Manager_csm__c != null
      `);

      console.log(`Found ${accounts.length} accounts with CSM assignments`);

      const assignments: CSMAssignment[] = accounts.map((account) => ({
        accountId: account.Id,
        accountName: account.Name,
        csmId: account.Customer_Success_Manager_csm__r?.Id || account.Customer_Success_Manager_csm__c || "",
        csmName: account.Customer_Success_Manager_csm__r?.Name || "",
        csmEmail: account.Customer_Success_Manager_csm__r?.Email || "",
      }));

      // Collect known CSM emails for EM fallback matching
      const knownCSMEmails = new Set(assignments.map(a => a.csmEmail.toLowerCase()).filter(Boolean));
      const assignedAccountIds = new Set(assignments.map(a => a.accountId));

      // EM fallback: find accounts with no CSM but an Engagement Manager who is a known CSM
      try {
        const emAccounts = await this.query<SFAccount>(`
          SELECT Id, Name,
                 Engagement_Manager__c, Engagement_Manager__r.Id,
                 Engagement_Manager__r.Name, Engagement_Manager__r.Email,
                 Engagement_Manager2__c, Engagement_Manager2__r.Id,
                 Engagement_Manager2__r.Name, Engagement_Manager2__r.Email
          FROM Account
          WHERE Customer_Success_Manager_csm__c = null
            AND (Engagement_Manager__c != null OR Engagement_Manager2__c != null)
        `);

        let emFallbackCount = 0;
        for (const account of emAccounts) {
          if (assignedAccountIds.has(account.Id)) continue;

          // Check EM1, then EM2 for a known CSM
          const em1Email = account.Engagement_Manager__r?.Email?.toLowerCase();
          const em2Email = account.Engagement_Manager2__r?.Email?.toLowerCase();

          if (em1Email && knownCSMEmails.has(em1Email)) {
            assignments.push({
              accountId: account.Id,
              accountName: account.Name,
              csmId: account.Engagement_Manager__r?.Id || account.Engagement_Manager__c || "",
              csmName: account.Engagement_Manager__r?.Name || "",
              csmEmail: account.Engagement_Manager__r?.Email || "",
            });
            assignedAccountIds.add(account.Id);
            emFallbackCount++;
          } else if (em2Email && knownCSMEmails.has(em2Email)) {
            assignments.push({
              accountId: account.Id,
              accountName: account.Name,
              csmId: account.Engagement_Manager2__r?.Id || account.Engagement_Manager2__c || "",
              csmName: account.Engagement_Manager2__r?.Name || "",
              csmEmail: account.Engagement_Manager2__r?.Email || "",
            });
            assignedAccountIds.add(account.Id);
            emFallbackCount++;
          }
        }
        if (emFallbackCount > 0) {
          console.log(`Added ${emFallbackCount} accounts via EM field fallback`);
        }
      } catch (emError) {
        console.warn("EM fallback query failed (fields may not exist):", emError);
      }

      return assignments;
    } catch (error) {
      console.error("Error fetching CSM assignments, trying alternative field names...", error);

      // Try with Owner as fallback (Account Owner often is the CSM in some orgs)
      try {
        const accounts = await this.query<SFAccount>(`
          SELECT Id, Name, OwnerId, Owner.Id, Owner.Name, Owner.Email
          FROM Account
          WHERE Owner.IsActive = true
        `);

        console.log(`Found ${accounts.length} accounts (using Owner as CSM)`);

        return accounts.map((account) => ({
          accountId: account.Id,
          accountName: account.Name,
          csmId: account.Owner?.Id || account.OwnerId || "",
          csmName: account.Owner?.Name || "",
          csmEmail: account.Owner?.Email || "",
        }));
      } catch (fallbackError) {
        console.error("Fallback query also failed:", fallbackError);
        throw fallbackError;
      }
    }
  }

  async getProjectManagerAssignments(): Promise<PMAssignment[]> {
    console.log("Fetching Project Manager assignments from Salesforce...");

    // Query accounts with Project Manager assignment using the Project_Manager__c field
    try {
      const accounts = await this.query<SFAccount>(`
        SELECT Id, Name, Project_Manager__c, Project_Manager__r.Id,
               Project_Manager__r.Name, Project_Manager__r.Email
        FROM Account
        WHERE Project_Manager__c != null
      `);

      console.log(`Found ${accounts.length} accounts with Project Manager assignments`);

      return accounts.map((account) => ({
        accountId: account.Id,
        accountName: account.Name,
        pmId: account.Project_Manager__r?.Id || account.Project_Manager__c || "",
        pmName: account.Project_Manager__r?.Name || "",
        pmEmail: account.Project_Manager__r?.Email || "",
      }));
    } catch (error) {
      console.error("Error fetching Project Manager assignments:", error);
      // Return empty array if field doesn't exist or query fails
      return [];
    }
  }

  async getAccountHierarchy(): Promise<AccountHierarchyEntry[]> {
    console.log("Fetching account hierarchy from Salesforce...");

    try {
      const accounts = await this.queryAll<SFAccountWithParent>(`
        SELECT Id, Name, ParentId, Parent.Id, Parent.Name
        FROM Account
      `);

      console.log(`Found ${accounts.length} accounts for hierarchy resolution`);

      // Build lookup map: accountId -> { name, parentId }
      const accountMap = new Map<string, { name: string; parentId: string | null }>();
      for (const account of accounts) {
        accountMap.set(account.Id, {
          name: account.Name,
          parentId: account.ParentId || null,
        });
      }

      // Resolve ultimate parent for each account (walk up the tree)
      const hierarchy: AccountHierarchyEntry[] = [];

      for (const account of accounts) {
        let currentId = account.Id;
        let ultimateParentId = account.Id;
        let ultimateParentName = account.Name;
        const visited = new Set<string>();

        while (true) {
          const current = accountMap.get(currentId);
          if (!current || !current.parentId || visited.has(current.parentId)) {
            ultimateParentId = currentId;
            ultimateParentName = current?.name || account.Name;
            break;
          }
          visited.add(currentId);
          currentId = current.parentId;
        }

        hierarchy.push({
          accountId: account.Id,
          accountName: account.Name,
          parentId: account.ParentId || null,
          parentName: account.Parent?.Name || null,
          ultimateParentId,
          ultimateParentName,
        });
      }

      const withParent = hierarchy.filter(h => h.parentId !== null);
      console.log(`Hierarchy resolved: ${hierarchy.length} accounts, ${withParent.length} have parent accounts`);

      return hierarchy;
    } catch (error) {
      console.error("Error fetching account hierarchy:", error);
      throw error;
    }
  }

  async getAccountFields(): Promise<string[]> {
    console.log("Fetching Account fields to find CSM field...");
    const describe = await this.describeObject("Account");
    return describe.fields.map((f: any) => `${f.name} (${f.type}): ${f.label}`);
  }

  async getOpportunityFields(): Promise<string[]> {
    console.log("Fetching Opportunity fields...");
    const describe = await this.describeObject("Opportunity");
    return describe.fields.map((f: any) => `${f.name} (${f.type}): ${f.label}`);
  }

  async findPRSFields(): Promise<{ accountFields: string[]; opportunityFields: string[] }> {
    console.log("Searching for PRS-related fields...");
    const [accountDescribe, oppDescribe] = await Promise.all([
      this.describeObject("Account"),
      this.describeObject("Opportunity"),
    ]);

    const accountFields = accountDescribe.fields
      .filter((f: any) =>
        f.name.toLowerCase().includes("retention") ||
        f.name.toLowerCase().includes("prs") ||
        f.label.toLowerCase().includes("retention") ||
        f.label.toLowerCase().includes("specialist")
      )
      .map((f: any) => `${f.name} (${f.type}): ${f.label}`);

    const opportunityFields = oppDescribe.fields
      .filter((f: any) =>
        f.name.toLowerCase().includes("retention") ||
        f.name.toLowerCase().includes("prs") ||
        f.label.toLowerCase().includes("retention") ||
        f.label.toLowerCase().includes("specialist")
      )
      .map((f: any) => `${f.name} (${f.type}): ${f.label}`);

    return { accountFields, opportunityFields };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      // Try a simple query
      const result = await this.query<{ Id: string }>("SELECT Id FROM Account LIMIT 1");
      return {
        success: true,
        message: `Connected to Salesforce. Instance: ${this.instanceUrl}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getEnterpriseSubscriptionsByAccountName(accountName: string): Promise<EnterpriseSubscription[]> {
    console.log(`Fetching enterprise subscriptions for account: ${accountName}`);

    // Escape single quotes in account name for SOQL
    const escapedName = accountName.replace(/'/g, "\\'");

    try {
      const subscriptions = await this.query<SFEnterpriseSubscription>(`
        SELECT Id, Name, Account__c, Product_Type__c, License_Count__c, Assigned_Seats__c,
               Percentage_Assigned__c, Environment__c, Type__c, Start_Date__c, End_Date__c,
               Monitor_Page_Count__c, Monitor_Project_Count__c, Enterprise_UUID__c, Enterprise_Domain__c
        FROM Enterprise_Subscription__c
        WHERE Account__r.Name = '${escapedName}'
        AND Type__c = 'paid'
        AND End_Date__c >= TODAY
        ORDER BY Product_Type__c
      `);

      console.log(`Found ${subscriptions.length} active paid subscriptions for ${accountName}`);

      return subscriptions.map((sub) => ({
        id: sub.Id,
        name: sub.Name,
        accountId: sub.Account__c,
        productType: sub.Product_Type__c,
        licenseCount: sub.License_Count__c || 0,
        assignedSeats: sub.Assigned_Seats__c || 0,
        percentageAssigned: sub.Percentage_Assigned__c || 0,
        environment: sub.Environment__c || "default",
        type: sub.Type__c,
        startDate: sub.Start_Date__c,
        endDate: sub.End_Date__c,
        monitorPageCount: sub.Monitor_Page_Count__c,
        monitorProjectCount: sub.Monitor_Project_Count__c,
        enterpriseUuid: sub.Enterprise_UUID__c,
        enterpriseDomain: sub.Enterprise_Domain__c,
      }));
    } catch (error) {
      console.error(`Error fetching subscriptions for ${accountName}:`, error);
      throw error;
    }
  }

  async getEnterpriseSubscriptionsByAccountId(accountId: string): Promise<EnterpriseSubscription[]> {
    console.log(`Fetching enterprise subscriptions for account ID: ${accountId}`);

    try {
      const subscriptions = await this.query<SFEnterpriseSubscription>(`
        SELECT Id, Name, Account__c, Product_Type__c, License_Count__c, Assigned_Seats__c,
               Percentage_Assigned__c, Environment__c, Type__c, Start_Date__c, End_Date__c,
               Monitor_Page_Count__c, Monitor_Project_Count__c, Enterprise_UUID__c, Enterprise_Domain__c
        FROM Enterprise_Subscription__c
        WHERE Account__c = '${accountId}'
        AND Type__c = 'paid'
        AND End_Date__c >= TODAY
        ORDER BY Product_Type__c
      `);

      console.log(`Found ${subscriptions.length} active paid subscriptions for account ${accountId}`);

      return subscriptions.map((sub) => ({
        id: sub.Id,
        name: sub.Name,
        accountId: sub.Account__c,
        productType: sub.Product_Type__c,
        licenseCount: sub.License_Count__c || 0,
        assignedSeats: sub.Assigned_Seats__c || 0,
        percentageAssigned: sub.Percentage_Assigned__c || 0,
        environment: sub.Environment__c || "default",
        type: sub.Type__c,
        startDate: sub.Start_Date__c,
        endDate: sub.End_Date__c,
        monitorPageCount: sub.Monitor_Page_Count__c,
        monitorProjectCount: sub.Monitor_Project_Count__c,
        enterpriseUuid: sub.Enterprise_UUID__c,
        enterpriseDomain: sub.Enterprise_Domain__c,
      }));
    } catch (error) {
      console.error(`Error fetching subscriptions for account ${accountId}:`, error);
      throw error;
    }
  }

  async getAccountsWithActiveSubscriptions(): Promise<string[]> {
    console.log("Fetching all accounts with active subscriptions...");

    try {
      // Query all subscriptions and extract unique account names
      // Using a simple query without GROUP BY to avoid SOQL aggregation issues with related fields
      const results = await this.query<{ Account__r: { Name: string } | null }>(`
        SELECT Account__r.Name
        FROM Enterprise_Subscription__c
        WHERE Type__c = 'paid'
        AND End_Date__c >= TODAY
        AND Account__r.Name != null
      `);

      // Extract unique account names
      const accountNameSet = new Set<string>();
      for (const r of results) {
        if (r.Account__r?.Name) {
          accountNameSet.add(r.Account__r.Name);
        }
      }

      const accountNames = Array.from(accountNameSet);
      console.log(`Found ${accountNames.length} accounts with active subscriptions`);

      return accountNames;
    } catch (error) {
      console.error("Error fetching accounts with subscriptions:", error);
      throw error;
    }
  }

  async getPRSAssignments(): Promise<PRSAssignment[]> {
    console.log("Fetching PRS assignments from Product Success object...");

    try {
      const productSuccessRecords = await this.query<SFProductSuccess>(`
        SELECT Id, Name, Account__c, Account__r.Id, Account__r.Name,
               Product_Retention_Specialist__c, Product_Retention_Specialist__r.Id,
               Product_Retention_Specialist__r.Name, Product_Retention_Specialist__r.Email
        FROM Product_Success__c
        WHERE Product_Retention_Specialist__c != null
      `);

      console.log(`Found ${productSuccessRecords.length} Product Success records with PRS`);

      return productSuccessRecords.map((ps) => ({
        accountId: ps.Account__c,
        accountName: ps.Account__r?.Name || "",
        prsId: ps.Product_Retention_Specialist__r?.Id || ps.Product_Retention_Specialist__c || "",
        prsName: ps.Product_Retention_Specialist__r?.Name || "",
        prsEmail: ps.Product_Retention_Specialist__r?.Email || "",
      }));
    } catch (error) {
      console.error("Error fetching PRS assignments:", error);
      // Return empty array if Product Success object doesn't exist or field is different
      return [];
    }
  }

  async getRenewalOpportunities(daysAhead: number = 180): Promise<RenewalOpportunity[]> {
    console.log(`Fetching renewal opportunities for next ${daysAhead} days...`);

    try {
      // Calculate the date range
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + daysAhead);
      const futureDateStr = futureDate.toISOString().split("T")[0]; // YYYY-MM-DD format

      // Query opportunities with PRS from both Opportunity and Account
      // Account uses Customer_Success_Specialist__c (reference, labeled "Product Retention Specialist")
      // Opportunity uses Product_Retention_Specialist__c (string field)
      const opportunities = await this.queryAll<SFOpportunity>(`
        SELECT Id, Name, AccountId, Account.Id, Account.Name,
               Account.Customer_Success_Manager_csm__r.Name,
               Account.Customer_Success_Manager_csm__r.Email,
               Account.Customer_Success_Specialist__c,
               Account.Customer_Success_Specialist__r.Id,
               Account.Customer_Success_Specialist__r.Name,
               Account.Customer_Success_Specialist__r.Email,
               Product_Retention_Specialist__c,
               (SELECT ContactId, Contact.Name, Contact.Email, Role, IsPrimary
                FROM OpportunityContactRoles
                ORDER BY IsPrimary DESC LIMIT 1),
               Amount, StageName,
               CloseDate, Type, OwnerId, Owner.Id, Owner.Name, Owner.Email,
               CreatedDate, LastModifiedDate,
               Customer_Success_Renewal_Status__c, Renewal_Status__c,
               PO_Required__c, PO_Received_Date__c,
               Renewal_Status_1__c, Customer_Success_Next_Steps__c, Accounting_Notes_for_Renewal__c,
               Leadership_Notes__c, Leadership_Risk_Status__c
        FROM Opportunity
        WHERE Type = 'Renewal'
        AND CloseDate >= 2026-01-01
        AND CloseDate <= ${futureDateStr}
        ORDER BY CloseDate ASC
      `);

      console.log(`Found ${opportunities.length} renewal opportunities`);

      return opportunities.map((opp) => {
        // Extract champion/primary contact from OpportunityContactRoles, fall back to custom fields
        const champion = opp.OpportunityContactRoles?.records?.[0];
        return {
          id: opp.Id,
          name: opp.Name,
          accountId: opp.AccountId,
          accountName: opp.Account?.Name || "",
          amount: opp.Amount || 0,
          stageName: opp.StageName,
          renewalDate: opp.CloseDate,
          type: opp.Type,
          ownerId: opp.OwnerId,
          ownerName: opp.Owner?.Name || "",
          ownerEmail: opp.Owner?.Email || "",
          createdDate: opp.CreatedDate,
          lastModifiedDate: opp.LastModifiedDate,
          productName: opp.Product_Name__c,
          contactName: champion?.Contact?.Name || opp.Contact_Name__c,
          contactEmail: champion?.Contact?.Email || opp.Contact_Email__c,
          // CSM from Account
          csmName: opp.Account?.Customer_Success_Manager_csm__r?.Name,
          csmEmail: opp.Account?.Customer_Success_Manager_csm__r?.Email,
          // PRS - check Opportunity first (string field), then fall back to Account (reference field)
          prsId: opp.Account?.Customer_Success_Specialist__r?.Id || opp.Account?.Customer_Success_Specialist__c,
          prsName: opp.Product_Retention_Specialist__c || opp.Account?.Customer_Success_Specialist__r?.Name,
          prsEmail: opp.Account?.Customer_Success_Specialist__r?.Email,
          // Additional renewal fields
          renewalStatus: opp.Customer_Success_Renewal_Status__c,  // "Renewal Status"
          accountingRenewalStatus: opp.Renewal_Status__c,  // "Accounting Renewal Status"
          poRequired: opp.PO_Required__c,
          poReceivedDate: opp.PO_Received_Date__c,
          atRisk: !!opp.Leadership_Risk_Status__c,  // Based on Leadership Risk Status picklist
          r6Notes: opp.Renewal_Status_1__c,
          r3Notes: opp.Customer_Success_Next_Steps__c,
          accountingNotes: opp.Accounting_Notes_for_Renewal__c,
          leadershipNotes: opp.Leadership_Notes__c,
          leadershipRiskStatus: opp.Leadership_Risk_Status__c,
        };
      });
    } catch (error) {
      console.error("Error fetching renewal opportunities:", error);
      throw error;
    }
  }
}
