/**
 * Core types for MapGL MCP server
 */

// ─── Internal types (used in tool schemas and MCP interface) ────────────────

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface POISearchParams {
  query: string;
  center?: Coordinate;
  radius?: number; // meters
}

export interface POIResult {
  id: string;
  name: string;
  address: string;
  coordinate: Coordinate;
  categories: string[];
  distance?: number; // meters from center
}

export interface RouteParams {
  start: Coordinate | string; // coordinate or address
  end: Coordinate | string;
  via?: (Coordinate | string)[];
  profile: 'car' | 'taxi' | 'pedestrian' | 'bicycle' | 'scooter' | 'motorcycle' | 'truck';
  route_mode?: 'fastest' | 'shortest';
  traffic_mode?: 'jam' | 'statistics';
  filters?: string[];
  locale?: string;
}

export interface RouteManeuver {
  type: string;
  comment: string;
  distance: number; // meters
  duration: number; // seconds
  street_names?: string[];
}

export interface RouteResult {
  distance: number; // meters
  duration: number; // seconds
  ui_distance: string;
  ui_duration: string;
  maneuvers: RouteManeuver[];
  alternatives?: RouteResult[];
}

export interface GeocodeParams {
  query: string;
}

export interface GeocodeResult {
  address: string;
  coordinate: Coordinate;
  bbox?: BoundingBox;
  confidence: number;
}

export interface ReverseGeocodeParams {
  coordinate: Coordinate;
  radius?: number; // 0–2000 meters (default 0 for lon/lat mode)
}

export interface MapViewParams {
  center: Coordinate;
  zoom?: number;
  markers?: {
    coordinate: Coordinate;
    color?: string;
  }[];
  lines?: {
    points: Coordinate[];
    color?: string;  // hex RRGGBB (default: blue)
    width?: number;  // pixels
  }[];
  polygons?: {
    points: Coordinate[];
    strokeColor?: string;  // hex RRGGBB
    strokeWidth?: number;  // pixels
    fillColor?: string;    // hex RRGGBBAA (alpha optional)
  }[];
  width?: number;
  height?: number;
}

export interface MapViewResult {
  imageUrl: string;
  bbox: BoundingBox;
}

export interface IsochroneParams {
  coordinate: Coordinate;
  profile: 'car' | 'pedestrian' | 'bicycle' | 'public_transport';
  intervals: number[]; // seconds, max 5 values, each max 3600
  reverse?: boolean;
  start_time?: string;
}

export interface IsochroneResult {
  intervals: {
    time: number; // seconds
    geometry: string; // WKT MULTIPOLYGON
    status?: string;
  }[];
  transport: string;
  status: string;
}

// ─── 2GIS API request/response types (match API documentation exactly) ──────

/** POST /routing/7.0.0/global — точка маршрута */
export interface RoutingApiPoint {
  lat: number;
  lon: number;
  type?: 'stop' | 'walking' | 'pref';
  start?: boolean;
  azimuth?: number;
}

/** POST /routing/7.0.0/global — тело запроса */
export interface RoutingApiRequest {
  points: RoutingApiPoint[];
  transport?: 'driving' | 'taxi' | 'walking' | 'bicycle' | 'scooter' | 'motorcycle' | 'truck' | 'emergency';
  route_mode?: 'fastest' | 'shortest';
  traffic_mode?: 'jam' | 'statistics';
  output?: 'summary' | 'detailed';
  locale?: 'ru' | 'en' | 'uk' | 'es' | 'it' | 'cs' | 'ar' | 'az' | 'uz' | 'kk' | 'hy' | 'ka' | 'tg' | 'ky';
  filters?: Array<'dirt_road' | 'toll_road' | 'ferry' | 'highway' | 'ban_car_road' | 'ban_stairway'>;
  alternative?: number;
}

/** POST /routing/7.0.0/global — маневр в ответе */
export interface RoutingApiManeuver {
  type: string;
  comment?: string;
  outcoming_path_comment?: string;
  outcoming_path?: {
    distance: number;
    duration: number;
    names?: string[];
    geometry?: any[];
  };
}

/** POST /routing/7.0.0/global — маршрут в ответе */
export interface RoutingApiRoute {
  total_distance: number;
  total_duration: number;
  ui_total_distance?: { value: string; unit: string };
  ui_total_duration?: string;
  maneuvers?: RoutingApiManeuver[];
}

/** POST /routing/7.0.0/global — ответ */
export interface RoutingApiResponse {
  status?: string;
  type?: string;
  result?: RoutingApiRoute[];
}

/** POST /isochrone/2.0.0 — тело запроса */
export interface IsochroneApiRequest {
  start: { lat: number; lon: number };
  durations: number[];
  transport?: 'driving' | 'walking' | 'bicycle' | 'motorcycle' | 'public_transport';
  reverse?: boolean;
  start_time?: string;
  format?: 'wkt';
}

/** POST /isochrone/2.0.0 — элемент ответа */
export interface IsochroneApiIsochrone {
  duration: number;
  geometry: string;
  status?: string;
}

/** POST /isochrone/2.0.0 — ответ */
export interface IsochroneApiResponse {
  status: string;
  transport?: string;
  isochrones?: IsochroneApiIsochrone[];
}

/** GET /3.0/items — элемент ответа Catalog API */
export interface CatalogApiItem {
  id: string;
  name: string;
  address_name?: string;
  full_name?: string;
  type?: string;
  point?: { lat: number; lon: number };
  address?: any;
  rubrics?: Array<{ id: string; name: string }>;
  confidence?: number;
}

/** GET /3.0/items, /3.0/items/geocode — ответ Catalog API */
export interface CatalogApiResponse {
  meta: { code: number; error?: { message: string } };
  result?: {
    items?: CatalogApiItem[];
    total?: number;
  };
}