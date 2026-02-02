/**
 * GitHub Projects Integration Service
 *
 * Fetches GitHub Projects v2 data and links issues to Zendesk tickets
 * by extracting ticket references from GitHub issue titles and bodies.
 */

export interface GitHubConfig {
  token: string;
  org: string;
  projectNumbers?: number[];
}

export interface GitHubProjectItem {
  id: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  repoName: string;
  projectTitle: string;
  status: string;
  sprint?: string;
  milestone?: string;
  releaseVersion?: string;
  url: string;
  updatedAt: string;
}

export interface ZendeskTicketLink {
  zendeskTicketId: number;
  githubIssueNumber: number;
  repoName: string;
  projectTitle: string;
  projectStatus: string;
  sprint?: string;
  milestone?: string;
  releaseVersion?: string;
  githubUrl: string;
  updatedAt: string;
}

// GraphQL query for GitHub Projects v2
const GET_PROJECT_ITEMS_QUERY = `
  query GetProjectItems($org: String!, $projectNumber: Int!, $cursor: String) {
    organization(login: $org) {
      projectV2(number: $projectNumber) {
        id
        title
        items(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            content {
              ... on Issue {
                number
                title
                body
                url
                updatedAt
                milestone {
                  title
                }
                repository {
                  name
                }
              }
              ... on PullRequest {
                number
                title
                body
                url
                updatedAt
                milestone {
                  title
                }
                repository {
                  name
                }
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  field {
                    ... on ProjectV2IterationField {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field {
                    ... on ProjectV2Field {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Query to list all projects in an org (for discovery)
const LIST_PROJECTS_QUERY = `
  query ListProjects($org: String!, $cursor: String) {
    organization(login: $org) {
      projectsV2(first: 20, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          closed
        }
      }
    }
  }
`;

// GraphQL Response Types
interface ListProjectsResponse {
  organization: {
    projectsV2: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: Array<{ number: number; title: string; closed: boolean }>;
    };
  };
}

interface ProjectItemsResponse {
  organization: {
    projectV2: {
      title: string;
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: Array<{
          id: string;
          content: {
            number?: number;
            title?: string;
            body?: string;
            url?: string;
            updatedAt?: string;
            milestone?: { title: string } | null;
            repository?: { name: string };
          } | null;
          fieldValues: {
            nodes: Array<{
              name?: string;
              title?: string;
              text?: string;
              field?: { name: string };
            }>;
          };
        }>;
      };
    } | null;
  };
}

export class GitHubService {
  private config: GitHubConfig;
  private baseUrl = "https://api.github.com/graphql";

  constructor(config: GitHubConfig) {
    this.config = config;
  }

  /**
   * Make a GraphQL request to GitHub API
   */
  private async graphql<T>(query: string, variables: Record<string, any>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${text}`);
    }

    const json = await response.json();

    if (json.errors) {
      throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    return json.data as T;
  }

  /**
   * List all GitHub Projects v2 in the organization
   */
  async listProjects(): Promise<Array<{ number: number; title: string; closed: boolean }>> {
    const projects: Array<{ number: number; title: string; closed: boolean }> = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const data: ListProjectsResponse = await this.graphql<ListProjectsResponse>(LIST_PROJECTS_QUERY, {
        org: this.config.org,
        cursor,
      });

      projects.push(...data.organization.projectsV2.nodes);

      if (data.organization.projectsV2.pageInfo.hasNextPage) {
        cursor = data.organization.projectsV2.pageInfo.endCursor;
      } else {
        hasMore = false;
      }
    }

    return projects;
  }

  /**
   * Fetch all items from a GitHub Project v2
   */
  async fetchProjectItems(projectNumber: number): Promise<GitHubProjectItem[]> {
    const items: GitHubProjectItem[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const data: ProjectItemsResponse = await this.graphql<ProjectItemsResponse>(GET_PROJECT_ITEMS_QUERY, {
        org: this.config.org,
        projectNumber,
        cursor,
      });

      const project = data.organization.projectV2;
      if (!project) {
        console.warn(`Project #${projectNumber} not found in org ${this.config.org}`);
        break;
      }

      for (const node of project.items.nodes) {
        const content = node.content;
        if (!content || !content.number) continue; // Skip draft items

        // Extract field values
        let status = "";
        let sprint: string | undefined;
        let releaseVersion: string | undefined;

        for (const fieldValue of node.fieldValues.nodes) {
          const fieldName = fieldValue.field?.name?.toLowerCase() || "";

          // Status field (usually "Status")
          if (fieldName === "status" && fieldValue.name) {
            status = fieldValue.name;
          }
          // Sprint/Iteration field
          if ((fieldName.includes("sprint") || fieldName.includes("iteration")) && fieldValue.title) {
            sprint = fieldValue.title;
          }
          // Release/Version field
          if ((fieldName.includes("release") || fieldName.includes("version")) && (fieldValue.name || fieldValue.text)) {
            releaseVersion = fieldValue.name || fieldValue.text;
          }
        }

        items.push({
          id: node.id,
          issueNumber: content.number,
          issueTitle: content.title || "",
          issueBody: content.body || "",
          repoName: content.repository?.name || "",
          projectTitle: project.title,
          status,
          sprint,
          milestone: content.milestone?.title,
          releaseVersion,
          url: content.url || "",
          updatedAt: content.updatedAt || "",
        });
      }

      if (project.items.pageInfo.hasNextPage) {
        cursor = project.items.pageInfo.endCursor;
      } else {
        hasMore = false;
      }
    }

    return items;
  }

  /**
   * Extract Zendesk ticket IDs from issue title and body
   * Looks for patterns like:
   * - ZD#12345, ZD-12345
   * - Zendesk: 12345, Zendesk #12345
   * - zendesk.com/agent/tickets/12345
   * - [Ticket #12345]
   */
  extractZendeskTicketReferences(item: GitHubProjectItem): number[] {
    const patterns = [
      /ZD[#\-]?(\d+)/gi, // ZD#12345, ZD-12345, ZD12345
      /Zendesk[:\s#]+(\d+)/gi, // Zendesk: 12345, Zendesk #12345
      /zendesk\.com\/agent\/tickets\/(\d+)/gi, // URL pattern
      /\[?Ticket[:\s#]+(\d+)\]?/gi, // [Ticket #12345]
      /dequehelp\.zendesk\.com[^\s]*\/(\d+)/gi, // Full Zendesk URL
    ];

    const text = `${item.issueTitle} ${item.issueBody}`;
    const ticketIds = new Set<number>();

    for (const pattern of patterns) {
      let match;
      // Reset pattern state for global regex
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        const ticketId = parseInt(match[1], 10);
        if (ticketId > 0 && ticketId < 10000000) {
          // Reasonable ticket ID range
          ticketIds.add(ticketId);
        }
      }
    }

    return Array.from(ticketIds);
  }

  /**
   * Fetch all project items and link them to Zendesk tickets
   */
  async getLinkedIssues(): Promise<ZendeskTicketLink[]> {
    const links: ZendeskTicketLink[] = [];
    const projectNumbers = this.config.projectNumbers || [];

    if (projectNumbers.length === 0) {
      console.warn("No GitHub project numbers configured");
      return links;
    }

    for (const projectNumber of projectNumbers) {
      try {
        console.log(`Fetching items from GitHub Project #${projectNumber}...`);
        const items = await this.fetchProjectItems(projectNumber);
        console.log(`  Found ${items.length} items in project`);

        for (const item of items) {
          const ticketIds = this.extractZendeskTicketReferences(item);

          for (const ticketId of ticketIds) {
            links.push({
              zendeskTicketId: ticketId,
              githubIssueNumber: item.issueNumber,
              repoName: item.repoName,
              projectTitle: item.projectTitle,
              projectStatus: item.status,
              sprint: item.sprint,
              milestone: item.milestone,
              releaseVersion: item.releaseVersion,
              githubUrl: item.url,
              updatedAt: item.updatedAt,
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching project #${projectNumber}:`, error);
        // Continue with other projects
      }
    }

    console.log(`Total: ${links.length} Zendesk ticket links found`);
    return links;
  }

  /**
   * Test the connection to GitHub API
   */
  async testConnection(): Promise<boolean> {
    try {
      const projects = await this.listProjects();
      console.log(`GitHub connection successful. Found ${projects.length} projects in ${this.config.org}`);
      return true;
    } catch (error) {
      console.error("GitHub connection failed:", error);
      return false;
    }
  }
}
