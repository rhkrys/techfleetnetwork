import { useEffect, useState, useMemo } from "react";
import { Globe } from "lucide-react";
import { safeRpc } from "@/lib/supabase/safe-rpc";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { COUNTRY_NAME_TO_ID, COUNTRY_ID_TO_NAME } from "@/lib/country-id-map";
import countriesTopologyRaw from "world-atlas/countries-110m.json?raw";
import { PageTitle } from "@/components/ui/typography";

interface CountryCount {
  country: string;
  count: number;
  platform_count?: number;
  external_count?: number;
}


interface GeoFeature {
  type: "Feature";
  id: string;
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
}

const WIDTH = 800;
const HEIGHT = 450;

const projection = geoEqualEarth()
  .translate([WIDTH / 2, HEIGHT / 2])
  .scale(150);

const pathGenerator = geoPath().projection(projection);

const countriesTopology = JSON.parse(countriesTopologyRaw) as Topology<{ countries: GeometryCollection }>;

const countries = feature(
  countriesTopology,
  countriesTopology.objects.countries,
);

const WORLD_GEO_FEATURES = (countries as unknown as GeoJSON.FeatureCollection).features as unknown as GeoFeature[];

export function MemberWorldMap() {
  const [data, setData] = useState<CountryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);

  // Load member distribution (includes empty-country count)
  useEffect(() => {
    const load = async () => {
      const { data: result, error } = await safeRpc<CountryCount[]>(
        "get_member_country_distribution",
        undefined,
        { source: "MemberWorldMap.load", severity: "warn" },
      );
      if (!error && result) setData(result);
      setLoading(false);
    };
    load();
  }, []);

  // Map country name → count AND numeric id → counts
  const { countById, platformById, externalById, maxCount, totalMembers, totalPlatform, totalExternal, countriesRepresented, unspecifiedCount } = useMemo(() => {
    const byId = new Map<string, number>();
    const platById = new Map<string, number>();
    const extById = new Map<string, number>();
    let max = 1;
    let total = 0;
    let totalPlat = 0;
    let totalExt = 0;
    let unspecified = 0;

    data.forEach((d) => {
      total += d.count;
      totalPlat += d.platform_count ?? d.count;
      totalExt += d.external_count ?? 0;
      if (d.country === "Not specified") {
        unspecified = d.count;
        return;
      }
      const id = COUNTRY_NAME_TO_ID[d.country];
      if (id) {
        byId.set(id, d.count);
        platById.set(id, d.platform_count ?? d.count);
        extById.set(id, d.external_count ?? 0);
      }
      if (d.count > max) max = d.count;
    });

    return {
      countById: byId,
      platformById: platById,
      externalById: extById,
      maxCount: max,
      totalMembers: total,
      totalPlatform: totalPlat,
      totalExternal: totalExt,
      countriesRepresented: data.filter((d) => d.country !== "Not specified").length,
      unspecifiedCount: unspecified,
    };
  }, [data]);


  // Get fill opacity for a country based on member count
  function getFillOpacity(id: string): number {
    const count = countById.get(id);
    if (!count) return 0;
    // Scale from 0.25 to 1.0 based on count relative to max
    return 0.25 + (count / maxCount) * 0.75;
  }

  function getCountryName(id: string): string | undefined {
    return COUNTRY_ID_TO_NAME[id];
  }

  if (loading || WORLD_GEO_FEATURES.length === 0) {
    return (
      <div className="p-6" style={{ minHeight: 420 }}>
        <div className="h-6 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-[300px] bg-muted/30 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageTitle>Member Locations</PageTitle>
        <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
          <span>
            <strong className="text-foreground">{totalMembers.toLocaleString()}</strong> all-time signups
          </span>
          <span>
            <strong className="text-foreground">{countriesRepresented}</strong> countries
          </span>
          {unspecifiedCount > 0 && (
            <span>
              <strong className="text-foreground">{unspecifiedCount}</strong> not specified
            </span>
          )}
        </div>

      </div>

      <div className="relative w-full overflow-hidden rounded-lg bg-muted/20 border border-border">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto"
          role="img"
          aria-label="World map showing member locations by country"
        >
          {WORLD_GEO_FEATURES.map((feat) => {
            const d = pathGenerator(feat as unknown as GeoJSON.Feature) || "";
            const id = feat.id;
            const count = countById.get(id) || 0;
            const hasMembers = count > 0;
            const isHovered = hoveredCountry === id;
            const name = getCountryName(id);

            return (
              <g key={id}>
                <path
                  d={d}
                  className={
                    hasMembers
                      ? "stroke-primary/40 cursor-pointer"
                      : "fill-muted/40 stroke-border/50"
                  }
                  fill={
                    hasMembers
                      ? `hsl(var(--primary) / ${getFillOpacity(id)})`
                      : undefined
                  }
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  onMouseEnter={() => setHoveredCountry(id)}
                  onMouseLeave={() => setHoveredCountry(null)}
                  style={{ transition: "fill 0.2s, stroke-width 0.15s" }}
                />
                {/* Tooltip */}
                {isHovered && hasMembers && name && (() => {
                  const centroid = pathGenerator.centroid(feat as unknown as GeoJSON.Feature);
                  if (!centroid || isNaN(centroid[0])) return null;
                  const label = `${name}: ${count} ${count === 1 ? "signup" : "signups"}`;
                  const labelWidth = Math.max(140, label.length * 6.5);

                  return (
                    <g className="pointer-events-none">
                      <rect
                        x={centroid[0] - labelWidth / 2}
                        y={centroid[1] - 28}
                        width={labelWidth}
                        height={22}
                        rx={4}
                        className="fill-popover stroke-border"
                      />
                      <text
                        x={centroid[0]}
                        y={centroid[1] - 15}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-popover-foreground"
                        fontSize={10}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      {data.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 flex-1">
            {data.filter((d) => d.country !== "Not specified").slice(0, 8).map((d) => (
              <div
                key={d.country}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 text-sm"
              >
                <div
                  className="h-2.5 w-2.5 rounded-full bg-primary flex-shrink-0"
                  style={{ opacity: 0.3 + (d.count / maxCount) * 0.7 }}
                />
                <span className="truncate text-foreground">{d.country}</span>
                <span className="ml-auto text-muted-foreground font-medium">{d.count}</span>
              </div>
            ))}
          </div>

          {/* Gradient legend */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Fewer</span>
            <div
              className="h-3 w-24 rounded-sm"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary) / 0.2), hsl(var(--primary)))`,
              }}
            />
            <span>More</span>
          </div>
        </div>
      )}
    </div>
  );
}
