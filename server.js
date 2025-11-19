// Simple HTTP server for GitHub App authentication backend
// Run with: node server.js

import "dotenv/config";
import http from "http";
import { URL } from "url";

const PORT = process.env.PORT || 3000;

// Your GitHub App credentials from .env
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID;
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET;
const APP_CALLBACK_URL = process.env.APP_CALLBACK_URL;

// Repository configuration for access control
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Jovit-Mathew236';
const GITHUB_REPO = process.env.GITHUB_REPO || 'plode-release-management';
const ACCESS_CONTROL_TYPE = process.env.ACCESS_CONTROL_TYPE || 'collaborator'; // 'collaborator' or 'organization'
const GITHUB_ORGANIZATION = process.env.GITHUB_ORGANIZATION || '';

if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
  console.error("ERROR: Missing environment variables!");
  console.error(
    "Please set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET in .env file"
  );
  process.exit(1);
}

if (ACCESS_CONTROL_TYPE === 'organization' && !GITHUB_ORGANIZATION) {
  console.error("ERROR: GITHUB_ORGANIZATION is required when ACCESS_CONTROL_TYPE=organization");
  process.exit(1);
}

// Helper function to check if user is a collaborator
async function isCollaborator(username, token) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/collaborators/${username}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github+json"
      }
    });

    // 204 = is a collaborator, 404 = not a collaborator
    return response.status === 204;
  } catch (error) {
    console.error("Error checking collaborator status:", error);
    return false;
  }
}

// Helper function to check if user is an organization member
async function isOrganizationMember(username, token) {
  const url = `https://api.github.com/orgs/${GITHUB_ORGANIZATION}/members/${username}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github+json"
      }
    });

    // 204 = is a member, 404 = not a member
    return response.status === 204;
  } catch (error) {
    console.error("Error checking organization membership:", error);
    return false;
  }
}

// Main access control check
async function hasAccess(username, token) {
  if (ACCESS_CONTROL_TYPE === 'organization') {
    console.log(`Checking organization membership for ${username} in ${GITHUB_ORGANIZATION}`);
    return await isOrganizationMember(username, token);
  } else {
    console.log(`Checking collaborator status for ${username} on ${GITHUB_OWNER}/${GITHUB_REPO}`);
    return await isCollaborator(username, token);
  }
}

// Helper function to get user info
async function getUserInfo(token) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  return response.json();
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GitHub App authentication endpoint
  if (url.pathname === "/api/auth" && req.method === "POST") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        console.log("Received body:", body);
        const { code } = JSON.parse(body);

        console.log("Extracted code:", code);

        if (!code) {
          console.error("Error: No code provided");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Code is required" }));
          return;
        }

        // Exchange code for access token
        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              client_id: GITHUB_APP_CLIENT_ID,
              client_secret: GITHUB_APP_CLIENT_SECRET,
              code: code,
            }),
          }
        );

        const data = await tokenResponse.json();

        console.log("GitHub response:", data);

        if (data.error) {
          console.error("GitHub error:", data.error, data.error_description);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: data.error_description || data.error })
          );
          return;
        }

        console.log("Success! Access token received. Checking user permissions...");

        // Get user information
        const user = await getUserInfo(data.access_token);
        console.log(`User authenticated: ${user.login}`);

        // Check if user has access (collaborator or organization member)
        const userHasAccess = await hasAccess(user.login, data.access_token);

        if (!userHasAccess) {
          const accessType = ACCESS_CONTROL_TYPE === 'organization' ? 'organization member' : 'collaborator';
          const accessScope = ACCESS_CONTROL_TYPE === 'organization'
            ? `organization ${GITHUB_ORGANIZATION}`
            : `repository ${GITHUB_OWNER}/${GITHUB_REPO}`;

          console.log(`Access denied for user: ${user.login} - Not a ${accessType}`);
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Access Denied",
            message: `You must be a ${accessType} of ${accessScope} to use this application.`
          }));
          return;
        }

        console.log(`Access granted for ${ACCESS_CONTROL_TYPE === 'organization' ? 'organization member' : 'collaborator'}: ${user.login}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: data.access_token,
          user: {
            login: user.login,
            avatar_url: user.avatar_url,
            name: user.name
          }
        }));
      } catch (error) {
        console.error("GitHub App authentication error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error",
            details: error.message,
          })
        );
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`GitHub App authentication backend running on http://localhost:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/api/auth`);
  console.log(`Callback URL: ${APP_CALLBACK_URL || 'Not configured'}`);
});
