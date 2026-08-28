import { LoginPanel } from "@/components/auth/login-panel";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

type LoginErrorCode = "invalid_credentials" | "rate_limited";

function parseErrorCode(value: string | undefined): LoginErrorCode | null {
  return value === "invalid_credentials" || value === "rate_limited" ? value : null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <LoginPanel errorCode={parseErrorCode(resolvedSearchParams.error)} />
    </main>
  );
}
