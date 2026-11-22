"use client";
// 도시 안 동선 지도: 숙소(네모)와 날짜별 방문 순서(번호), 날짜마다 다른 색 선
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import type { DayRoute, PlaceOption } from "@/lib/types";

export const DAY_COLORS = ["#1d4b5c", "#a8650f", "#34539f", "#2c7a4b", "#8a3b8f", "#b0281d", "#4a5a6e"];

export default function CityRouteMap({ days, byId, hotel }: { days: DayRoute[]; byId: Map<string, PlaceOption>; hotel?: PlaceOption }) {
  const all = [hotel, ...days.flatMap((d) => d.stops.map((s) => byId.get(s.id)))].filter((x): x is PlaceOption => !!x);
  if (!all.length) return null;
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const pad = 0.004;
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats) - pad, Math.min(...lngs) - pad],
    [Math.max(...lats) + pad, Math.max(...lngs) + pad],
  ];
  return (
    <div className="map small-map">
      <MapContainer bounds={bounds} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {days.map((d, di) => {
          const pts = [hotel, ...d.stops.map((s) => byId.get(s.id)), hotel].filter((x): x is PlaceOption => !!x).map((p) => [p.lat, p.lng] as [number, number]);
          return <Polyline key={d.date} positions={pts} pathOptions={{ color: DAY_COLORS[di % DAY_COLORS.length], weight: 3, opacity: 0.8 }} />;
        })}
        {days.flatMap((d, di) =>
          d.stops.map((s, si) => {
            const p = byId.get(s.id);
            if (!p) return null;
            return (
              <CircleMarker key={s.id} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: DAY_COLORS[di % DAY_COLORS.length], fillColor: "#fff", fillOpacity: 1, weight: 3 }}>
                <Tooltip>
                  {di + 1}일차 {si + 1}. {s.time} {p.name}
                </Tooltip>
              </CircleMarker>
            );
          }),
        )}
        {hotel ? (
          <CircleMarker center={[hotel.lat, hotel.lng]} radius={10} pathOptions={{ color: "#18263a", fillColor: "#f4d35e", fillOpacity: 1, weight: 3 }}>
            <Tooltip permanent direction="top" offset={[0, -8]}>
              숙소
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>
    </div>
  );
}
