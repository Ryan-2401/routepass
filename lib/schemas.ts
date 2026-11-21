// API 입력 검증 스키마 (서버에서 사용)
import { z } from "zod";

export const PlaceSchema = z.object({
  name: z.string(),
  nameEn: z.string(),
  country: z.string(),
  region: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  airports: z.array(z.string()),
  cityCode: z.string().optional(),
});

export const CandidateSchema = z.object({
  id: z.string(),
  mode: z.enum(["flight", "train", "bus", "ferry", "car", "walk"]),
  description: z.string(),
  operatorHint: z.string().optional(),
  estDurationMin: z.number().optional(),
  estPriceKRW: z.number().optional(),
  borderCrossing: z.boolean().optional(),
  notes: z.string().optional(),
});

export const LegSchema = z.object({
  index: z.number().int(),
  from: PlaceSchema,
  to: PlaceSchema,
  date: z.string(),
  distanceKm: z.number(),
  candidates: z.array(CandidateSchema),
});

export const TripRequestSchema = z.object({
  cities: z.array(z.object({ name: z.string().min(1).max(60), days: z.number().int().min(1).max(30).optional() })).min(1).max(8),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDays: z.number().int().min(1).max(60).optional(),
  budget: z.enum(["low", "mid", "high"]),
  interests: z.array(z.string().max(30)).max(10),
  travelers: z.number().int().min(1).max(10),
});
