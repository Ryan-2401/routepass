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
  cities: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        country: z.string().length(2).optional(),
        days: z.number().int().min(1).max(30).optional(),
        geo: z
          .object({ nameEn: z.string().max(100), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), region: z.string().max(100).optional() })
          .optional(),
      }),
    )
    .min(1)
    .max(8),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDays: z.number().int().min(1).max(60).optional(),
  budgetKRW: z.number().int().min(100000).max(100000000),
  budgetToleranceKRW: z.number().int().min(0).max(50000000),
  lodgingClass: z.enum(["any", "hostel", "3", "4", "5"]).default("any"),
  mealBudgetKRW: z.number().int().min(5000).max(2000000).default(40000),
  interests: z.array(z.string().max(30)).max(10),
  travelers: z.number().int().min(1).max(10),
});

export const PlaceOptionSchema = z.object({
  id: z.string().max(120),
  kind: z.enum(["hotel", "restaurant", "sight"]),
  name: z.string().max(200),
  lat: z.number(),
  lng: z.number(),
  category: z.string().max(40).optional(),
  priceKRW: z.number().optional(),
  priceNote: z.string().max(80).optional(),
  stars: z.number().optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  openingHours: z.string().max(300).optional(),
  hoursText: z.string().max(300).optional(),
  link: z.string().max(2000).optional(),
  mapUrl: z.string().max(500),
  source: z.enum(["google-hotels", "osm", "search+ai", "ai-plan"]),
  reason: z.string().max(300).optional(),
  special: z.object({ by: z.string().max(80), title: z.string().max(200), url: z.string().max(1000) }).optional(),
});
