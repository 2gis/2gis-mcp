/**
 * Client for interacting with MapGL backend API
 * This is where you would implement actual API calls to your MapGL service
 */

import { distance } from '@turf/turf';
import {
  POISearchParams, POIResult,
  RouteParams, RouteResult, RouteManeuver,
  GeocodeParams, GeocodeResult,
  ReverseGeocodeParams,
  MapViewParams, MapViewResult,
  IsochroneParams, IsochroneResult,
  RoutingApiRequest, RoutingApiPoint, RoutingApiResponse,
  IsochroneApiRequest, IsochroneApiResponse,
  CatalogApiResponse,
} from './types.js';
import { VERSION } from './version.js';

const catalogFields = [
  'items.point',
  'items.address',
  'items.rubrics',
];

export class MapGLClient {
  private apiKey: string;
  private routingApiKey: string;
  private baseUrl: string;
  private static readonly USER_AGENT = `2gis-mcp/${VERSION}`;

  constructor(apiKey: string, routingApiKey?: string, baseUrl: string = 'https://api.mapgl.com/v1') {
    this.apiKey = apiKey;
    this.routingApiKey = routingApiKey || apiKey;
    this.baseUrl = baseUrl;
  }

  private async fetchWithUserAgent(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
      'User-Agent': MapGLClient.USER_AGENT,
    };
    // eslint-disable-next-line no-restricted-syntax
    return fetch(url, { ...init, headers });
  }

  /**
   * Поиск POI через Catalog API.
   * GET https://catalog.api.2gis.com/3.0/items?q=...&point=LON,LAT&radius=N&fields=...&key=KEY
   *
   * LLM вызывает с аргументами:
   *   { query: "кофейня", center: {lat: 55.75, lng: 37.62}, radius: 500 }
   */
  async searchPOI(params: POISearchParams): Promise<POIResult[]> {
    const queryUrl = `https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent(params.query)}&fields=${catalogFields.join(',')}&point=${params.center?.lng ?? 0},${params.center?.lat ?? 0}&radius=${params.radius}&key=${this.apiKey}`;
    const result = await this.fetchWithUserAgent(queryUrl);
    const data: CatalogApiResponse = await result.json();

    if (data.meta.code !== 200) {
      throw new Error(`API Error: ${data.meta.code} - ${data.meta.error?.message}`);
    }
    if (!data.result?.items || data.result.items.length === 0) {
      return [];
    }

    return data.result.items.map((item) => ({
      id: item.id,
      name: item.name,
      address: item.address,
      coordinate: { lat: item.point!.lat, lng: item.point!.lon },
      categories: (item.rubrics ?? []).map((r) => r.name),
      distance: params.center && item.point
        ? distance([params.center.lng, params.center.lat], [item.point.lon, item.point.lat])
        : NaN
    }));
  }

  /**
   * Построение маршрута через Routing API.
   * POST https://routing.api.2gis.com/routing/7.0.0/global?key=KEY
   *
   * LLM вызывает с аргументами (примеры):
   *   { start: {lat: 55.75, lng: 37.62}, end: {lat: 55.76, lng: 37.63}, profile: "car" }
   *   { start: "Невский проспект", end: "Эрмитаж", profile: "pedestrian" }
   *   { start: "55.75,37.62", end: {lat: 55.76, lng: 37.63}, profile: "taxi" }
   *   { start: "{\"lat\": 55.75, \"lng\": 37.62}", end: ..., profile: "car" }
   */
  async calculateRoute(params: RouteParams): Promise<RouteResult> {
    const profileMap: Record<string, RoutingApiRequest['transport']> = {
      car: 'driving',
      taxi: 'taxi',
      pedestrian: 'walking',
      bicycle: 'bicycle',
      scooter: 'scooter',
      motorcycle: 'motorcycle',
      truck: 'truck',
    };

    const transport = profileMap[params.profile] || 'driving';

    const startPoint = await this.resolvePoint(params.start);
    const endPoint = await this.resolvePoint(params.end);

    // Для пешеходных маршрутов start/end используют type "walking" (обход препятствий)
    const pointType: RoutingApiPoint['type'] = transport === 'walking' ? 'walking' : 'stop';

    const points: RoutingApiPoint[] = [
      { type: pointType, lat: startPoint.lat, lon: startPoint.lon },
    ];

    if (params.via) {
      for (const viaPoint of params.via) {
        const resolved = await this.resolvePoint(viaPoint);
        points.push({ type: 'pref', lat: resolved.lat, lon: resolved.lon });
      }
    }

    points.push({ type: pointType, lat: endPoint.lat, lon: endPoint.lon });

    const body: RoutingApiRequest = {
      points,
      transport,
      route_mode: params.route_mode || 'fastest',
      traffic_mode: params.traffic_mode || 'jam',
      output: 'detailed',
      locale: (params.locale as RoutingApiRequest['locale']) || 'ru',
    };

    if (params.filters && params.filters.length > 0) {
      body.filters = params.filters as RoutingApiRequest['filters'];
    }

    const url = `https://routing.api.2gis.com/routing/7.0.0/global?key=${this.routingApiKey}`;
    const response = await this.fetchWithUserAgent(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data: RoutingApiResponse = await response.json();

    if (data.status !== 'OK' && (!data.result || data.result.length === 0)) {
      throw new Error(`Routing API error: ${data.status || 'unknown'} - ${JSON.stringify(data)}`);
    }

    const routes = data.result!.map((route) => {
      const maneuvers: RouteManeuver[] = (route.maneuvers || []).map((m) => ({
        type: m.type,
        comment: m.comment || m.outcoming_path_comment || '',
        distance: m.outcoming_path?.distance || 0,
        duration: m.outcoming_path?.duration || 0,
        street_names: m.outcoming_path?.names || [],
      }));

      return {
        distance: route.total_distance,
        duration: route.total_duration,
        ui_distance: route.ui_total_distance
          ? `${route.ui_total_distance.value} ${route.ui_total_distance.unit}`
          : `${route.total_distance} m`,
        ui_duration: route.ui_total_duration || `${Math.round(route.total_duration / 60)} мин`,
        maneuvers,
      };
    });

    const primary: RouteResult = routes[0];
    if (routes.length > 1) {
      primary.alternatives = routes.slice(1);
    }

    return primary;
  }

  /**
   * Парсинг координатной точки из различных форматов, которые генерируют LLM.
   * Поддерживает:
   *   - объект {lat, lng} или {lat, lon}
   *   - JSON-строку '{"lat": 55.75, "lng": 37.62}'
   *   - строку "55.75,37.62"
   *   - строку JS-объекта "{lat: 55.75, lng: 37.62}"
   *   - текстовый адрес "Невский проспект" → геокодирование
   */
  private async resolvePoint(point: any): Promise<{ lat: number; lon: number }> {
    // Объект с числовыми полями
    if (typeof point === 'object' && point !== null) {
      const lat = Number(point.lat);
      const lon = Number(point.lng ?? point.lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lon };
      }
    }

    if (typeof point === 'string') {
      // Попытка распарсить как JSON: '{"lat": 55.75, "lng": 37.62}'
      try {
        const parsed = JSON.parse(point);
        if (typeof parsed === 'object' && parsed !== null) {
          const lat = Number(parsed.lat);
          const lon = Number(parsed.lng ?? parsed.lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            return { lat, lon };
          }
        }
      } catch {
        // Не JSON — пробуем другие форматы
      }

      // Формат "55.75,37.61"
      const csvMatch = point.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
      if (csvMatch) {
        return { lat: parseFloat(csvMatch[1]), lon: parseFloat(csvMatch[2]) };
      }

      // Формат "{lat: 55.75, lng: 37.61}" (JS-объект без кавычек)
      const latMatch = point.match(/lat\s*[:=]\s*(-?\d+\.?\d*)/);
      const lonMatch = point.match(/(?:lng|lon)\s*[:=]\s*(-?\d+\.?\d*)/);
      if (latMatch && lonMatch) {
        return { lat: parseFloat(latMatch[1]), lon: parseFloat(lonMatch[1]) };
      }

      // Текстовый адрес → геокодирование
      const geocoded = await this.geocode({ query: point });
      if (geocoded.length === 0) {
        throw new Error(`Could not geocode address: ${point}`);
      }
      return { lat: geocoded[0].coordinate.lat, lon: geocoded[0].coordinate.lng };
    }

    throw new Error(`Invalid point format: ${JSON.stringify(point)}`);
  }

  /**
   * Прямое геокодирование через Catalog API.
   * GET https://catalog.api.2gis.com/3.0/items/geocode?q=QUERY&fields=items.point,items.address_name&key=KEY
   *
   * LLM вызывает с аргументами:
   *   { query: "Красная площадь, Москва" }
   */
  async geocode(params: GeocodeParams): Promise<GeocodeResult[]> {
    const url = `https://catalog.api.2gis.com/3.0/items/geocode?q=${encodeURIComponent(params.query)}&fields=items.point,items.address_name&key=${this.apiKey}`;
    const result = await this.fetchWithUserAgent(url);
    const data: CatalogApiResponse = await result.json();

    if (!data.result?.items || data.result.items.length === 0) {
      return [];
    }

    return data.result.items
      .filter((item) => item.point != null)
      .map((item) => ({
        address: item.address_name || item.full_name || item.name,
        coordinate: { lat: item.point!.lat, lng: item.point!.lon },
        confidence: item.confidence ?? 1
      }));
  }

  /**
   * Обратное геокодирование через Catalog API.
   * GET https://catalog.api.2gis.com/3.0/items/geocode?lat=N&lon=M&fields=items.point,items.address_name&key=KEY
   *
   * LLM вызывает с аргументами:
   *   { coordinate: {lat: 55.75, lng: 37.62} }
   */
  async reverseGeocode(params: ReverseGeocodeParams): Promise<GeocodeResult> {
    let url = `https://catalog.api.2gis.com/3.0/items/geocode?lat=${params.coordinate.lat}&lon=${params.coordinate.lng}&fields=items.point,items.address_name&key=${this.apiKey}`;
    if (params.radius !== undefined) {
      url += `&radius=${params.radius}`;
    }
    const result = await this.fetchWithUserAgent(url);
    const data: CatalogApiResponse = await result.json();

    if (!data.result?.items || data.result.items.length === 0) {
      throw new Error(`Reverse geocode: no results for ${params.coordinate.lat}, ${params.coordinate.lng}`);
    }

    const item = data.result.items[0];
    return {
      address: item.address_name || item.full_name || item.name,
      coordinate: item.point
        ? { lat: item.point.lat, lng: item.point.lon }
        : params.coordinate,
      confidence: item.confidence ?? 1
    };
  }

  /**
   * Создание статической карты через Static Maps API v1.0.
   * Используется v1.0, т.к. не требует API-ключа и возвращает PNG напрямую.
   * GET https://static.maps.2gis.com/1.0?s=WxH&z=N&c=LAT,LON[&pt=...][&ls=...][&pn=...]
   *
   * LLM вызывает с аргументами:
   *   { center: {lat: 55.75, lng: 37.62}, zoom: 14 }
   *   { center: {lat: 55.75, lng: 37.62}, markers: [{coordinate: {lat: 55.76, lng: 37.63}, color: "red"}] }
   *   { center: {lat: 55.75, lng: 37.62}, lines: [{points: [{lat: 55.73, lng: 37.52}, {lat: 55.74, lng: 37.53}], color: "ff0000", width: 5}] }
   */
  async createMapView(params: MapViewParams): Promise<MapViewResult> {

    function translateColor(color?: string): string {
        switch (color) {
            case 'blue': return 'be';
            case 'red': return 'rd';
            case 'green': return 'gn';
            case 'orange': return 'oe';
            case 'yellow': return 'yw';
            case 'purple': return 'pe';
            case 'pink': return 'pk';
            case 'grey': return 'gy';
            case 'black': return 'bk';

            default: return 'be';
        }
    }

    const width = params.width || 800;
    const height = params.height || 600;
    // Static Maps API v1.0 — не требует API-ключа, возвращает PNG напрямую
    let url = `https://static.maps.2gis.com/1.0?s=${width}x${height}&z=${params.zoom || 14}&c=${params.center.lat},${params.center.lng}`;
    for (const marker of params.markers || []) {
      url += `&pt=${marker.coordinate.lat},${marker.coordinate.lng}~k:c~c:${translateColor(marker.color)}`;
    }
    for (const line of params.lines || []) {
      const coords = line.points.map(p => `${p.lat},${p.lng}`).join(',');
      let ls = `&ls=${coords}`;
      if (line.width) ls += `~w:${line.width}`;
      if (line.color) ls += `~c:${line.color}`;
      url += ls;
    }
    for (const poly of params.polygons || []) {
      const coords = poly.points.map(p => `${p.lat},${p.lng}`).join(',');
      let pn = `&pn=${coords}`;
      if (poly.strokeWidth) pn += `~w:${poly.strokeWidth}`;
      if (poly.strokeColor) pn += `~c:${poly.strokeColor}`;
      if (poly.fillColor) pn += `~f:${poly.fillColor}`;
      url += pn;
    }
    const image = await this.fetchWithUserAgent(url).then(r => r.arrayBuffer()).then(buffer => Buffer.from(buffer).toString('base64'));
    return {
      imageUrl: image,
      bbox: {
        north: params.center.lat + 0.01,
        south: params.center.lat - 0.01,
        east: params.center.lng + 0.01,
        west: params.center.lng - 0.01
      }
    };
  }

  /**
   * Расчёт изохрон через Isochrone API.
   * POST https://routing.api.2gis.com/isochrone/2.0.0?key=KEY
   *
   * LLM вызывает с аргументами:
   *   { coordinate: {lat: 55.75, lng: 37.62}, profile: "car", intervals: [300, 600] }
   *   { coordinate: {lat: 55.75, lng: 37.62}, profile: "pedestrian", intervals: [600], reverse: true }
   */
  async calculateIsochrone(params: IsochroneParams): Promise<IsochroneResult> {
    const profileMap: Record<string, IsochroneApiRequest['transport']> = {
      car: 'driving',
      pedestrian: 'walking',
      bicycle: 'bicycle',
      public_transport: 'public_transport',
    };

    const transport = profileMap[params.profile] || 'driving';

    const body: IsochroneApiRequest = {
      start: { lat: params.coordinate.lat, lon: params.coordinate.lng },
      durations: params.intervals,
      transport,
      format: 'wkt',
    };

    if (params.reverse !== undefined) {
      body.reverse = params.reverse;
    }
    if (params.start_time) {
      body.start_time = params.start_time;
    }

    const url = `https://routing.api.2gis.com/isochrone/2.0.0?key=${this.routingApiKey}`;
    const response = await this.fetchWithUserAgent(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data: IsochroneApiResponse = await response.json();

    if (data.status !== 'OK' && data.status !== 'partial_success') {
      throw new Error(`Isochrone API error: ${data.status || 'unknown'} - ${JSON.stringify(data)}`);
    }

    return {
      intervals: (data.isochrones || []).map((iso: any) => ({
        time: iso.duration,
        geometry: iso.geometry,
        status: iso.status,
      })),
      transport: data.transport || '',
      status: data.status,
    };
  }
}
