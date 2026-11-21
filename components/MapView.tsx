"use client";
// 지도: OpenStreetMap 타일 + Leaflet (무료, 키 없음)
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import type { Plan, Restaurant } from "@/lib/types";

export default function MapView({ plan, restaurants }: { plan: Plan; restaurants: Restaurant[] }) {
  const pts: [number, number][] = [
    [plan.origin.lat, plan.origin.lng],
    ...plan.stays.map((s) => [s.place.lat, s.place.lng] as [number, number]),
    [plan.origin.lat, plan.origin.lng],
  ];
  const cityPts = plan.stays.map((s) => [s.place.lat, s.place.lng] as [number, number]);
  const lats = cityPts.map((p) => p[0]);
  const lngs = cityPts.map((p) => p[1]);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats) - 2, Math.min(...lngs) - 3],
    [Math.max(...lats) + 2, Math.max(...lngs) + 3],
  ];
  return (
    <div className="map">
      <MapContainer bounds={bounds} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={pts.slice(1, -1)} pathOptions={{ color: "#18263a", weight: 4 }} />
        <Polyline positions={pts.slice(0, 2)} pathOptions={{ color: "#18263a", weight: 2, dashArray: "6 8" }} />
        <Polyline positions={pts.slice(-2)} pathOptions={{ color: "#18263a", weight: 2, dashArray: "6 8" }} />
        {plan.stays.map((s, i) => (
          <CircleMarker key={s.place.name} center={[s.place.lat, s.place.lng]} radius={9} pathOptions={{ color: "#18263a", fillColor: "#fbfcfa", fillOpacity: 1, weight: 4 }}>
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {i + 1}. {s.place.name}
            </Tooltip>
          </CircleMarker>
        ))}
        {restaurants.map((r) => (
          <CircleMarker key={r.osmId} center={[r.lat, r.lng]} radius={4} pathOptions={{ color: "#a8650f", fillOpacity: 0.9, weight: 1 }}>
            <Tooltip>{r.name}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
