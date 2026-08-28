"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api/client";
import { subscribeFormalDashboardRefresh } from "@/lib/formal-data-changes";
import type { DashboardSummary } from "@/lib/types";
import {
  DashboardHeaderView,
  STORE_OVERVIEW_HEADER,
} from "@/components/dashboard/dashboard-header";
import { TeamPerformanceSection } from "@/components/dashboard/team-performance";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardBody } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/language";

const TOP_CARD_IDS = [
  "today_revenue",
  "accounts_receivable",
  "vehicles_today",
  "vehicles_stuck",
] as const;
const BOTTOM_CARD_IDS = [
  "completed_labor",
  "prepaid_incomplete",
  "internal_tasks",
  "risk_alerts",
] as const;
const REQUIRED_CARD_IDS = [...TOP_CARD_IDS, ...BOTTOM_CARD_IDS];

export default function DashboardPage() {
  const { language, t } = useI18n();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const load = () => {
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError(null);
      api.dashboard().then((next) => {
        if (!active || generation !== loadGeneration.current) return;
        setData(next);
        setLoading(false);
      }).catch((cause: unknown) => {
        if (!active || generation !== loadGeneration.current) return;
        setError(language === "en" ? t("dashboard.error.load") : cause instanceof Error ? cause.message : t("dashboard.error.load"));
        setLoading(false);
      });
    };
    load();
    const unsubscribe = subscribeFormalDashboardRefresh(load);
    return () => {
      active = false;
      loadGeneration.current += 1;
      unsubscribe();
    };
  }, [language, t]);

  const cardsById = new Map(
    data ? [...data.topCards, ...data.bottomCards].map((card) => [card.id, card]) : [],
  );
  const missingCardIds = REQUIRED_CARD_IDS.filter((id) => !cardsById.has(id));

  return (
    <div className="p-3 sm:p-5">
      <div data-testid="dashboard-content" className="mx-auto w-full max-w-[1320px]">
        <DashboardHeaderView header={data?.header ?? STORE_OVERVIEW_HEADER} />

        {error ? (
          <Card className="mt-3">
            <CardBody className="py-12 text-center">
              <p className="text-danger">{t("dashboard.error.failed", { message: error })}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-600"
              >
                {t("common.retry")}
              </button>
            </CardBody>
          </Card>
        ) : !loading && data && missingCardIds.length > 0 ? (
          <Card className="mt-3">
            <CardBody className="py-12 text-center">
              <p className="text-danger">
                {t("dashboard.error.incomplete", { ids: missingCardIds.join(", ") })}
              </p>
            </CardBody>
          </Card>
        ) : loading ? (
          <>
          <div className="mt-3 h-40 w-full skeleton" />
          <div className="mt-4 grid grid-cols-12 gap-4">
            <Skeleton className="col-span-5 h-64" />
            <Skeleton className="col-span-4 h-64" />
            <Skeleton className="col-span-3 h-64" />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
          </>
        ) : (
          <>
          {/* 各维修班组本月绩效 */}
          <div className="mt-3">
            <TeamPerformanceSection
              data={data!.teamPerformance}
              header={data!.header}
            />
          </div>

          {/* 第一行：两张主卡 + 两张右侧纵向卡片 */}
          <div className="mt-3 grid grid-cols-1 gap-4 lg:min-h-[250px] lg:grid-cols-12">
            <div data-testid="top-metric-card" className="flex lg:col-span-5">
              <MetricCard card={cardsById.get(TOP_CARD_IDS[0])!} />
            </div>
            <div data-testid="top-metric-card" className="flex lg:col-span-4">
              <MetricCard card={cardsById.get(TOP_CARD_IDS[1])!} />
            </div>
            <div
              data-testid="top-metric-stack"
              className="flex flex-col gap-4 lg:col-span-3"
            >
              <div data-testid="top-metric-card" className="flex flex-1">
                <MetricCard card={cardsById.get(TOP_CARD_IDS[2])!} compact />
              </div>
              <div data-testid="top-metric-card" className="flex flex-1">
                <MetricCard card={cardsById.get(TOP_CARD_IDS[3])!} compact />
              </div>
            </div>
          </div>

          {/* 第二行：四张等高等宽卡片 */}
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:min-h-[186px] lg:grid-cols-4">
            {BOTTOM_CARD_IDS.map((id) => {
              const card = cardsById.get(id)!;
              return (
                <div key={card.id} data-testid="bottom-metric-card" className="flex">
                  <MetricCard card={card} />
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
