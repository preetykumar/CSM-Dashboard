# Zendesk MCP Server

A Model Context Protocol (MCP) server for accessing Zendesk Ticketing API. This server provides tools to fetch ticket details and search tickets using various filters.

## Features

- **getTicketByID**: Fetch a specific ticket by its ID with complete ticket details
- **searchTickets**: Search for tickets with dynamic field discovery and filtering
- **searchOrganizations**: Search for organizations by name or fetch by ID
- Automatic field discovery from your Zendesk instance
- Support for custom fields and standard ticket properties
- Dynamic filtering based on available custom fields in your Zendesk instance
- Efficient pagination support for large result sets (up to 1000 tickets)
- Comprehensive error handling and validation
- Basic authentication using email and API token

## Setup

### Prerequisites

- Node.js 18+ 
- A Zendesk instance with API access
- Zendesk API token

### Installation

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

### Configuration

Set the following environment variables:

- `ZENDESK_SUBDOMAIN`: Your Zendesk subdomain (e.g., "mycompany" for mycompany.zendesk.com)
- `ZENDESK_EMAIL`: Your Zendesk account email
- `ZENDESK_API_TOKEN`: Your Zendesk API token

#### Getting a Zendesk API Token

1. Log into your Zendesk instance as an admin
2. Go to Admin Center → Apps and integrations → APIs → Zendesk API
3. Enable token access and create a new API token
4. Copy the token value

Example:
```bash
export ZENDESK_SUBDOMAIN="mycompany"
export ZENDESK_EMAIL="admin@mycompany.com"
export ZENDESK_API_TOKEN="your_api_token_here"
```

## Usage

### Running the Server

```bash
npm start
```

The server communicates via stdio and is designed to be used with MCP-compatible clients.

### Available Tools

#### getTicketByID

Fetches a specific ticket by its ID with complete ticket details including custom fields, collaborators, and all metadata.

**Parameters:**
- `ticketId` (required): The ID of the ticket to fetch

**Returns:**
Complete ticket object with all fields, custom fields, timestamps, and relationships.

**Example:**
```json
{
  "name": "getTicketByID",
  "arguments": {
    "ticketId": "12345"
  }
}
```

#### searchOrganizations

Search for organizations by name or fetch a specific organization by ID.

**Parameters:**
- `organizationId` (optional): The ID of the organization to fetch
- `organizationName` (optional): The name of the organization to search for

**Note:** Either `organizationId` or `organizationName` must be provided.

**Returns:**
- When searching by ID: Complete organization object
- When searching by name: Array of matching organizations with metadata

**Examples:**
```json
{
  "name": "searchOrganizations",
  "arguments": {
    "organizationId": "123456"
  }
}
```

```json
{
  "name": "searchOrganizations",
  "arguments": {
    "organizationName": "ADP, Inc"
  }
}
```

#### searchTickets

Searches for tickets using Zendesk's search API with dynamic field filtering. Automatically discovers and supports all custom fields from your Zendesk instance.

**Parameters:**
- `query` (required): Search query using Zendesk search syntax
- `sort_by` (optional): Sort field (updated_at, created_at, priority, status, ticket_type)
- `sort_order` (optional): Sort order (asc, desc)
- Additional dynamic fields based on your Zendesk configuration (automatically discovered)

**Returns:**
Array of ticket IDs matching the search criteria, with pagination metadata showing total count and pages fetched.

**Example:**
```json
{
  "name": "searchTickets",
  "arguments": {
    "query": "type:ticket status:open",
    "sort_by": "updated_at",
    "sort_order": "desc"
  }
}
```

**Advanced Filtering Examples:**
```json
{
  "name": "searchTickets",
  "arguments": {
    "query": "requester:*@adp.com",
    "priority": "high"
  }
}
```

### Search Query Syntax

The search tool supports Zendesk's powerful query syntax:

**Basic Filters:**
- `type:ticket` - Search only tickets
- `status:open` - Filter by status (open, pending, solved, closed)
- `priority:high` - Filter by priority (low, normal, high, urgent)
- `assignee:john@company.com` - Filter by assignee email
- `requester:*@adp.com` - Filter by requester (supports wildcards)
- `organization:"ADP, Inc"` - Filter by organization name

**Date Range Filters:**
- `created>2024-01-01` - Created after date
- `created<2024-12-31` - Created before date
- `updated>2024-01-01` - Updated after date
- `created:2024-01-01..2024-01-31` - Date range

**Text Search:**
- `subject:"login issues"` - Text search in subject
- `description:"error message"` - Text search in description
- `"API error"` - General text search across all fields

**Advanced Examples:**
- `type:ticket status:open priority:high` - Multiple filters
- `requester:*@adp.com status:pending` - ADP users with pending tickets
- `created>2024-01-01 subject:"accessibility"` - Recent accessibility tickets
- `organization:"ADP, Inc" status:open` - Open tickets from ADP

## Development

### Scripts

- `npm run build` - Compile TypeScript
- `npm run dev` - Watch mode compilation
- `npm start` - Run the compiled server

### Project Structure

```
src/
  index.ts          # Main MCP server implementation
dist/               # Compiled JavaScript output
package.json        # Dependencies and scripts
tsconfig.json       # TypeScript configuration
```

## Authentication

This server uses Zendesk's basic authentication with email and API token. The authentication is handled automatically using the configured environment variables.

## Technical Details

### Pagination
- **searchTickets** automatically handles pagination to fetch up to 1000 tickets
- Uses maximum page size (100) for efficiency
- Returns metadata showing total count and pages fetched
- Safety limit of 10 pages to prevent excessive API calls

### Custom Fields
- Automatically discovers all custom fields from your Zendesk instance
- Dynamically generates filtering parameters for each active field
- Supports dropdown field options and validation
- Handles field name normalization for API compatibility

### Response Formats
- **getTicketByID**: Complete ticket object with all metadata
- **searchOrganizations**: Organization objects or search results array
- **searchTickets**: Array of ticket IDs with count metadata

## Error Handling

The server includes comprehensive error handling:

- Missing environment variables validation
- Invalid ticket IDs (404 errors) with descriptive messages
- API rate limiting and retry logic
- Network connectivity issues
- Invalid search queries with syntax validation
- Authentication failures (401/403 errors)
- Organization not found errors

Errors are returned as structured text content in the MCP response format with specific error details.

## Security Considerations

- Store API tokens securely (use environment variables, not hardcoded values)
- Ensure your Zendesk API token has appropriate permissions
- Consider IP restrictions on your Zendesk API access if needed
- The server only performs read operations on tickets

## Troubleshooting

### Common Issues

1. **"Missing required environment variables"**: Ensure all three environment variables (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN) are set
2. **"API error: 401"**: Check your email and API token are correct and properly formatted
3. **"API error: 403"**: Your API token may not have sufficient permissions for the requested operation
4. **"Ticket not found"**: Verify the ticket ID exists and you have access to it
5. **"Organization not found"**: Check the organization ID/name is correct and exists in your Zendesk instance
6. **Empty search results**: Verify your search query syntax and ensure you have access to the tickets you're searching for
7. **Field discovery issues**: Custom fields may take time to load; server will continue with basic functionality if field discovery fails

### Debug Mode

Set `DEBUG=1` to enable additional logging:

```bash
DEBUG=1 npm start
```