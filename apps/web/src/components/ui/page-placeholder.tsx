import { Card, CardBody } from "@/components/ui/card";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

interface PlaceholderProps {
  title: string;
  titleEn: string;
  description: string;
  breadcrumb: string;
}

export function PagePlaceholder({ title, titleEn, description, breadcrumb }: PlaceholderProps) {
  return (
    <div className="p-3 sm:p-5">
      <div className="mx-auto w-full max-w-[1320px]">
        <PageHeader breadcrumb={breadcrumb} title={title} description={description} />
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-state-info-subtle">
              <Construction size={32} className="text-state-info-text" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-ink">页面开发中</h2>
            <p className="mt-2 max-w-md text-center text-sm text-ink-soft">
              {description}
            </p>
            <p className="mt-1 text-xs text-ink-faint">{titleEn}</p>
            <p className="mt-4 text-xs text-ink-faint">
              下一阶段将逐页实现此模块
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
