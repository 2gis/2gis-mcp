/**
 * Main MCP server implementation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequest,
  ListToolsRequest,
  McpError,
  ErrorCode,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MapGLClient } from './mapgl-client.js';
import {
  Coordinate,
  POISearchParams,
  RouteParams,
  GeocodeParams,
  ReverseGeocodeParams,
  MapViewParams,
  IsochroneParams
} from './types.js';

class MapGLMCPServer {
  private server: Server;
  private mapglClient: MapGLClient;

  constructor() {
    this.server = new Server(
      {
        name: 'mapgl-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.mapglClient = new MapGLClient(
      process.env.MAPGL_API_KEY || 'demo',
      process.env.ROUTING_API_KEY
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_poi',
          description: 'Search for points of interest (restaurants, shops, landmarks, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (e.g., "coffee shop", "museum")' },
              center: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' }
                },
                description: 'Center point for search'
              },
              radius: { type: 'number', description: 'Search radius in meters' }
            },
            required: ['query', 'center', 'radius']
          }
        },
        {
          name: 'calculate_route',
          description: 'Calculate route between two or more points',
          inputSchema: {
            type: 'object',
            properties: {
              start: {
                oneOf: [
                  { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat', 'lng'] },
                  { type: 'string', description: 'Address to geocode, e.g. "Невский проспект, Санкт-Петербург"' }
                ],
                description: 'Start point. Prefer object {"lat": 55.75, "lng": 37.62}. Can also be a text address.'
              },
              end: {
                oneOf: [
                  { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat', 'lng'] },
                  { type: 'string', description: 'Address to geocode' }
                ],
                description: 'End point. Prefer object {"lat": 55.75, "lng": 37.62}. Can also be a text address.'
              },
              via: {
                type: 'array',
                items: {
                  type: ['string', 'object']
                },
                description: 'Via points'
              },
              profile: {
                type: 'string',
                enum: ['car', 'taxi', 'pedestrian', 'bicycle', 'scooter', 'motorcycle', 'truck'],
                description: 'Transportation profile'
              },
              route_mode: {
                type: 'string',
                enum: ['fastest', 'shortest'],
                description: 'Route optimization mode (default: fastest)'
              },
              traffic_mode: {
                type: 'string',
                enum: ['jam', 'statistics'],
                description: 'Traffic consideration mode: jam (real-time, default), statistics (historical average)'
              },
              filters: {
                type: 'array',
                items: { type: 'string' },
                description: 'Road types to exclude (e.g., toll_road, ferry, dirt_road)'
              }
            },
            required: ['start', 'end', 'profile']
          }
        },
        {
          name: 'geocode',
          description: 'Convert address to geographic coordinates. Returns address, coordinates, and confidence score. Supports Russian and international addresses.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Address to geocode' }
            },
            required: ['query']
          }
        },
        {
          name: 'reverse_geocode',
          description: 'Convert geographic coordinates to nearest address',
          inputSchema: {
            type: 'object',
            properties: {
              coordinate: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' }
                },
                required: ['lat', 'lng']
              },
              radius: {
                type: 'number',
                description: 'Search radius in meters'
              }
            },
            required: ['coordinate']
          }
        },
        {
          name: 'create_map_view',
          description: 'Create a static PNG map image using Static Maps API v1.0 (no API key required, returns PNG directly). Supports markers, polylines (for routes), and polygons. Marker colors: blue, red, green, orange, yellow, purple, pink, grey, black. Line/polygon colors: hex RRGGBB format.',
          inputSchema: {
            type: 'object',
            properties: {
              center: {
                type: 'object',
                properties: {
                  lat: { type: 'number', description: 'Latitude' },
                  lng: { type: 'number', description: 'Longitude' }
                },
                required: ['lat', 'lng'],
                description: 'Center point as {"lat": number, "lng": number}'
              },
              zoom: { type: 'number', description: 'Zoom level (1-18, default: 14)' },
              markers: {
                type: 'array',
                description: 'Array of map markers (pins)',
                items: {
                  type: 'object',
                  properties: {
                    coordinate: {
                      type: 'object',
                      properties: {
                        lat: { type: 'number' },
                        lng: { type: 'number' }
                      },
                      required: ['lat', 'lng']
                    },
                    color: {
                      type: 'string',
                      enum: ['blue', 'red', 'green', 'orange', 'yellow', 'purple', 'pink', 'grey', 'black'],
                      description: 'Marker color (default: blue)'
                    }
                  },
                  required: ['coordinate']
                }
              },
              lines: {
                type: 'array',
                description: 'Array of polylines to draw on the map (e.g., route paths). Each line connects a sequence of points.',
                items: {
                  type: 'object',
                  properties: {
                    points: {
                      type: 'array',
                      description: 'Ordered array of coordinates forming the line (minimum 2 points)',
                      items: {
                        type: 'object',
                        properties: {
                          lat: { type: 'number' },
                          lng: { type: 'number' }
                        },
                        required: ['lat', 'lng']
                      }
                    },
                    color: {
                      type: 'string',
                      description: 'Line color in hex RRGGBB format (e.g., "ff0000" for red, "00ff00" for green). Default: blue'
                    },
                    width: {
                      type: 'number',
                      description: 'Line width in pixels (e.g., 5)'
                    }
                  },
                  required: ['points']
                }
              },
              polygons: {
                type: 'array',
                description: 'Array of polygons to draw on the map (e.g., zones, areas). Each polygon requires at least 3 points.',
                items: {
                  type: 'object',
                  properties: {
                    points: {
                      type: 'array',
                      description: 'Ordered array of coordinates forming the polygon vertices (minimum 3 points)',
                      items: {
                        type: 'object',
                        properties: {
                          lat: { type: 'number' },
                          lng: { type: 'number' }
                        },
                        required: ['lat', 'lng']
                      }
                    },
                    strokeColor: {
                      type: 'string',
                      description: 'Outline color in hex RRGGBB format (e.g., "ff0000" for red). Default: blue'
                    },
                    strokeWidth: {
                      type: 'number',
                      description: 'Outline width in pixels'
                    },
                    fillColor: {
                      type: 'string',
                      description: 'Fill color in hex RRGGBB or RRGGBBAA format (e.g., "ff000080" for semi-transparent red). Default: semi-transparent blue'
                    }
                  },
                  required: ['points']
                }
              },
              width: { type: 'number', description: 'Image width in pixels (120-1280, default: 800)' },
              height: { type: 'number', description: 'Image height in pixels (90-1280, default: 600)' }
            },
            required: ['center']
          }
        },
        {
          name: 'calculate_isochrone',
          description: 'Calculate isochrone (reachability zone) — area reachable from a point within given time intervals. Returns polygons in WKT MULTIPOLYGON format. Max 5 intervals, each ≤ 3600s. reverse not supported for public_transport.',
          inputSchema: {
            type: 'object',
            properties: {
              coordinate: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' }
                },
                required: ['lat', 'lng'],
                description: 'Center point'
              },
              profile: {
                type: 'string',
                enum: ['car', 'pedestrian', 'bicycle', 'public_transport'],
                description: 'Transportation profile'
              },
              intervals: {
                type: 'array',
                items: { type: 'number' },
                description: 'Time intervals in seconds (max 5 values, each max 3600)'
              },
              reverse: {
                type: 'boolean',
                description: 'false = area reachable FROM point, true = area that can reach TO point'
              },
              start_time: {
                type: 'string',
                description: 'Departure time in RFC 3339 format (e.g., 2025-05-15T15:52:01Z)'
              }
            },
            required: ['coordinate', 'profile', 'intervals']
          }
        },
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_poi':
            return await this.handleSearchPOI(args as any as POISearchParams);

          case 'calculate_route':
            return await this.handleCalculateRoute(args as any as RouteParams);

          case 'geocode':
            return await this.handleGeocode(args as any as GeocodeParams);

          case 'reverse_geocode':
            return await this.handleReverseGeocode(args as any as ReverseGeocodeParams);

          case 'create_map_view':
            return await this.handleCreateMapView(args as any as MapViewParams);

          case 'calculate_isochrone':
            return await this.handleCalculateIsochrone(args as any as IsochroneParams);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        console.error(`Error in tool ${name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleSearchPOI(params: POISearchParams) {
    const results = await this.mapglClient.searchPOI(params);

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} points of interest for "${params.query}"`
        },
        {
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }

  private async handleCalculateRoute(params: RouteParams) {
    const result = await this.mapglClient.calculateRoute(params);

    const summary = `Route: ${result.ui_distance}, ${result.ui_duration}`;
    const altCount = result.alternatives?.length || 0;
    const altInfo = altCount > 0 ? ` (+ ${altCount} alternative routes)` : '';

    return {
      content: [
        {
          type: 'text',
          text: summary + altInfo
        },
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  private async handleGeocode(params: GeocodeParams) {
    const results = await this.mapglClient.geocode(params);

    return {
      content: [
        {
          type: 'text',
          text: `Geocoding results for "${params.query}": ${results.length} found`
        },
        {
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }

  private async handleReverseGeocode(params: ReverseGeocodeParams) {
    const result = await this.mapglClient.reverseGeocode(params);

    return {
      content: [
        {
          type: 'text',
          text: `Reverse geocode result: ${result.address}`
        },
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  private async handleCreateMapView(params: MapViewParams) {
    const result = await this.mapglClient.createMapView(params);

    return {
      content: [
        {
          type: 'text',
          text: `Map view created`
        },
        {
          type: 'image',
          data: result.imageUrl,
          mimeType: 'image/png'
        },
      ]
    };
  }

  private async handleCalculateIsochrone(params: IsochroneParams) {
    const result = await this.mapglClient.calculateIsochrone(params);

    return {
      content: [
        {
          type: 'text',
          text: `Isochrone calculated: ${result.intervals.length} zone(s), transport: ${result.transport}, status: ${result.status}`
        },
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Server Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MapGL MCP server running on stdio');
  }
}

// Start the server
const server = new MapGLMCPServer();
server.run().catch(console.error);