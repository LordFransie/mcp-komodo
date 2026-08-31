/**
 * Container domain tools: raw container listing plus log retrieval and search.
 *
 * Registers 2 MCP tools for Docker containers on Komodo Servers.
 * CRITICAL: Container logs require BOTH server AND container name parameters,
 * unlike deployment/stack logs which only need the resource name.
 *
 * komodo_list_containers calls the Komodo Core "ListDockerContainers" read,
 * which asks the Periphery agent on that server for every container Docker
 * knows about — including ones Komodo did not deploy. Komodo Core >= 2.3
 * renamed this to "ListContainers" but keeps "ListDockerContainers" as a
 * serde alias, so the legacy name works across Core 2.0-2.3+.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KomodoClient } from "../core/client.js";
import type { AppConfig } from "../core/config.js";
import { handleKomodoError } from "../core/errors.js";
import { formatContainerList, formatLog } from "../core/formatters.js";
import { registerTool } from "../core/tools.js";
import { SearchCombinator } from "../types/komodo.js";

const LIST_CONTAINERS_READ = "ListDockerContainers";

export function registerContainerTools(
  server: McpServer,
  client: KomodoClient,
  config: AppConfig,
): void {
  // -------------------------------------------------------------------------
  // komodo_list_containers
  // -------------------------------------------------------------------------
  registerTool(server, config, {
    name: "komodo_list_containers",
    title: "List Containers",
    description:
      "List every Docker container on a Komodo Server, including containers " +
      "Komodo did not deploy or does not manage (equivalent to `docker ps -a` " +
      "on that host). Shows container name, state, and image.",
    accessTier: "read-only",
    category: "containers",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      server: z
        .string()
        .describe("Server name or ID to list containers from"),
    },
    handler: async (args) => {
      const serverParam = args.server as string;
      try {
        const containers = await client.read(LIST_CONTAINERS_READ, {
          server: serverParam,
        });
        return {
          content: [
            { type: "text" as const, text: formatContainerList(containers) },
          ],
        };
      } catch (error) {
        return handleKomodoError(
          `listing containers on server '${serverParam}'`,
          error,
        );
      }
    },
  });

  // -------------------------------------------------------------------------
  // komodo_get_container_log
  // -------------------------------------------------------------------------
  registerTool(server, config, {
    name: "komodo_get_container_log",
    title: "Get Container Log",
    description:
      "Get logs from a Docker container running on a Komodo Server. " +
      "Requires both the server name and the container name. " +
      "Optionally search for specific terms in the log output.",
    accessTier: "read-only",
    category: "containers",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      server: z
        .string()
        .describe("Server name or ID where the container is running"),
      container: z.string().describe("Docker container name"),
      tail: z
        .number()
        .min(1)
        .max(5000)
        .optional()
        .describe("Number of log lines to return (default: 50, max: 5000)"),
      search_terms: z
        .array(z.string())
        .optional()
        .describe("Search for lines matching these terms"),
      search_combinator: z
        .enum(["And", "Or"])
        .optional()
        .describe("How to combine search terms (default: 'Or')"),
    },
    handler: async (args) => {
      const serverParam = args.server as string;
      const container = args.container as string;
      const tail = args.tail as number | undefined;
      const search_terms = args.search_terms as string[] | undefined;
      const search_combinator = args.search_combinator as string | undefined;
      try {
        const log = search_terms?.length
          ? await client.read("SearchContainerLog", {
              server: serverParam,
              container,
              terms: search_terms,
              combinator:
                (search_combinator as SearchCombinator) || SearchCombinator.Or,
            })
          : await client.read("GetContainerLog", {
              server: serverParam,
              container,
              tail: tail ?? 50,
            });
        return {
          content: [{ type: "text" as const, text: formatLog(log) }],
        };
      } catch (error) {
        return handleKomodoError(
          `getting container log for '${container}' on server '${serverParam}'`,
          error,
        );
      }
    },
  });
}
