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
  OwnerId?: string;
  Owner?: {
    Id: string;
    Name: string;
    Email: string;
  };
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

  async describeObject(objectName: string): Promise<any> {
    return this.apiCall("get", `/services/data/v59.0/sobjects/${objectName}/describe`);
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

      return accounts.map((account) => ({
        accountId: account.Id,
        accountName: account.Name,
        csmId: account.Customer_Success_Manager_csm__r?.Id || account.Customer_Success_Manager_csm__c || "",
        csmName: account.Customer_Success_Manager_csm__r?.Name || "",
        csmEmail: account.Customer_Success_Manager_csm__r?.Email || "",
      }));
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

  async getAccountFields(): Promise<string[]> {
    console.log("Fetching Account fields to find CSM field...");
    const describe = await this.describeObject("Account");
    return describe.fields.map((f: any) => `${f.name} (${f.type}): ${f.label}`);
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
}
