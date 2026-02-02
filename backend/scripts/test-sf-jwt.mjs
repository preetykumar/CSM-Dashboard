#!/usr/bin/env node

import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load config from .env
import 'dotenv/config';

const clientId = process.env.SF_CLIENT_ID;
const username = process.env.SF_USERNAME;
const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;
const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

console.log('Salesforce JWT Auth Test');
console.log('========================');
console.log('Client ID:', clientId?.substring(0, 20) + '...');
console.log('Username:', username);
console.log('Login URL:', loginUrl);
console.log('Private Key Path:', privateKeyPath);

// Resolve path relative to backend directory
const keyPath = path.resolve(path.join(__dirname, '..', privateKeyPath));
console.log('Resolved Key Path:', keyPath);

if (!fs.existsSync(keyPath)) {
  console.error('ERROR: Private key file not found!');
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8');
console.log('Private key loaded:', privateKey.substring(0, 30) + '...');

// Create JWT
const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: clientId,
  sub: username,
  aud: loginUrl,
  exp: now + 300,
};

console.log('\nJWT Claims:', JSON.stringify(claims, null, 2));

const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });
console.log('\nJWT created successfully');
console.log('Assertion (first 100 chars):', assertion.substring(0, 100) + '...');

// Exchange JWT for access token
console.log('\nExchanging JWT for access token...');

const params = new URLSearchParams();
params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
params.append('assertion', assertion);

try {
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const data = await response.json();

  if (response.ok) {
    console.log('\n✅ SUCCESS! Access token received');
    console.log('Instance URL:', data.instance_url);
    console.log('Token Type:', data.token_type);
    console.log('Access Token (first 50 chars):', data.access_token?.substring(0, 50) + '...');

    // Test a simple query
    console.log('\nTesting API call: querying Accounts with CSM...');
    const queryResponse = await fetch(
      `${data.instance_url}/services/data/v59.0/query?q=${encodeURIComponent('SELECT Id, Name FROM Account LIMIT 3')}`,
      {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const queryData = await queryResponse.json();
    if (queryResponse.ok) {
      console.log('✅ Query successful!');
      console.log('Sample accounts:', queryData.records?.map(r => r.Name).join(', '));
    } else {
      console.log('❌ Query failed:', queryData);
    }
  } else {
    console.log('\n❌ FAILED!');
    console.log('Error:', data.error);
    console.log('Description:', data.error_description);
  }
} catch (error) {
  console.error('\n❌ Error:', error.message);
}
