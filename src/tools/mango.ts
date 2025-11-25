import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
  server.registerTool(
    'get-screenshot',
    {
      description: `Get screenshot image from Mango share URL, which are typically on either the mangoapps.com or tinytake.com domain`,
      inputSchema: {
        share_url: z.string({ description: 'Mango share URL' }).url(),
      },
    },
    async ({ share_url }) => {
      const salt = validateAndExtractSalt(share_url);
      const html = await fetchHtmlContent(share_url);

      const fileId = extractFileId(html);
      if (!fileId) {
        throw new Error('Screenshot not found on page');
      }

      const { base64, contentType } = await fetchImageAsBase64(fileId, salt, share_url);

      return {
        content: [
          {
            type: 'image',
            data: base64,
            mimeType: contentType,
          },
        ],
      };
    }
  );
}

function validateAndExtractSalt(shareUrl: string) {
  // Support both mangoapps.com and tinytake.com formats (with any username)
  const mangoMatch = shareUrl.match(/^https:\/\/webpagefx\.mangoapps\.com\/msc\/([^/\s]+)$/);
  const tinyTakeMatch = shareUrl.match(/^https:\/\/[^.]+\.tinytake\.com\/msc\/([^/\s]+)$/);

  const match = mangoMatch || tinyTakeMatch;
  if (!match) {
    throw new Error('Invalid Mango share URL format');
  }

  return match[1];
}

async function fetchHtmlContent(shareUrl: string) {
  const response = await fetch(shareUrl, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

function extractFileId(html: string) {
  // Try mangoapps.com pattern first
  const mangoMatch = html.match(/\/mjanus\/f\/([a-zA-Z0-9]+)/);
  if (mangoMatch) {
    return mangoMatch[1];
  }

  // Try tinytake.com pattern - extract media ID from media URLs
  const tinyTakeMatch = html.match(/\/media\/([a-zA-Z0-9]+)\?/);
  if (tinyTakeMatch) {
    return tinyTakeMatch[1];
  }

  return null;
}

async function fetchImageAsBase64(fileId: string, salt: string, shareUrl: string) {
  let downloadUrl;

  if (shareUrl.includes('tinytake.com')) {
    const hostname = new URL(shareUrl).hostname;
    downloadUrl = `https://${hostname}/media/${fileId}?type=attachment&salt=${salt}&return_original_image=true`;
  } else {
    downloadUrl = `https://webpagefx.mangoapps.com/mjanus/f/${fileId}?salt=${salt}`;
  }

  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType) {
    throw new Error('Image content type not provided by server');
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  return { base64, contentType };
}
