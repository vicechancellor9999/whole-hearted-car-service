"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { CheckCircle2, ClipboardCheck, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api/client";
import type { CustomerDraftInput, CustomerRecord, CustomerType } from "@/lib/customers/types";
import type { LicenseExtractionClientFactory, LicenseExtractionField, PreparedLicenseEvidence } from "@/lib/customers/license-extraction/types";
import { assertLicenseImageInput, type LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";
import { prepareDriverLicenseEvidence } from "@/lib/customers/evidence-assets";
import { createBrowserLicenseExtractionClient } from "@/lib/customers/license-extraction/browser-client";
import type { MockCustomerVehicleE2EScenario } from "@/lib/api/mock-customers";
import { currentSessionKey } from "./detail-shared";
import {
  createCustomerOnboardingState,
  customerOnboardingReducer,
} from "./customer-onboarding-state";
import { DiscardConfirmation, useDirtyCloseGuard } from "./form-dialogs";
import { OnboardingPhoneStep } from "./onboarding-phone-step";
import { OnboardingLicenseStep } from "./onboarding-license-step";
import { OnboardingProfileStep, type OnboardingProfileFields } from "./onboarding-profile-step";

type AttemptKind = "phone" | "otp" | "evidence" | "extraction" | "kyc" | "name" | "preview" | "create";
type BusyAttemptKind = Exclude<AttemptKind, "evidence" | "extraction">;
type BusyAttempt = { readonly kind: BusyAttemptKind; readonly id: number };
type LicenseExtractionUiState = "idle" | "running" | "success" | "error";
type PreparedEvidenceGate = {
  readonly evidence: PreparedLicenseEvidence;
  readonly file: File;
  readonly imageKey: string;
  readonly attemptId: number;
};

const INITIAL_TRANSFORM: LicenseImageTransform = {
  rotation: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
};
const MANUAL_STATUS: Readonly<Record<LicenseExtractionField, "extracted" | "manual_required">> = {
  name: "manual_required",
  birthDate: "manual_required",
  sex: "manual_required",
  address: "manual_required",
};

function initialProfileFields(): OnboardingProfileFields {
  return {
    organizationName: "",
    primaryContactRole: "",
    salutation: "",
    language: "English",
    secondaryPhone: "",
    whatsapp: "",
    email: "",
    preferredChannel: "whatsapp",
    address: "",
    gender: "",
    birthDate: "",
    trn: "",
    status: "active",
    reason: "",
  };
}

function mutationId(label: string): string {
  return `customer-onboarding-${label}-${crypto.randomUUID()}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请重试";
}

function createConfiguredLicenseExtractionClient() {
  const browser = window as Window & { __WH_CUSTOMERS_TEST_SCENARIO__?: MockCustomerVehicleE2EScenario };
  return createBrowserLicenseExtractionClient(browser.__WH_CUSTOMERS_TEST_SCENARIO__?.licenseExtraction);
}

function readBoundSession(): { sessionKey: string; actorId: string } {
  const sessionKey = currentSessionKey();
  const raw = window.localStorage.getItem("wh_session");
  try {
    const value = JSON.parse(raw ?? "null") as { identity?: { id?: unknown } };
    const actorId = value.identity?.id;
    return { sessionKey, actorId: typeof actorId === "string" ? actorId : "invalid" };
  } catch {
    return { sessionKey, actorId: "invalid" };
  }
}

export function CustomerOnboardingDialog({
  customers,
  onClose,
  onSaved,
  licenseExtractionClientFactory = createConfiguredLicenseExtractionClient,
}: {
  customers: readonly CustomerRecord[];
  onClose: () => void;
  onSaved: (customer: CustomerRecord) => void | Promise<void>;
  licenseExtractionClientFactory?: LicenseExtractionClientFactory;
}) {
  const [boundSession] = useState(readBoundSession);
  const [state, dispatch] = useReducer(customerOnboardingReducer, undefined, () => createCustomerOnboardingState());
  const [profileFields, setProfileFields] = useState(initialProfileFields);
  const [otpCode, setOtpCode] = useState("");
  const [licenseMode, setLicenseMode] = useState<"ai" | "manual">("ai");
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseImageUrl, setLicenseImageUrl] = useState<string | null>(null);
  const [preparedEvidence, setPreparedEvidence] = useState<PreparedEvidenceGate | null>(null);
  const [transform, setTransform] = useState<LicenseImageTransform>(INITIAL_TRANSFORM);
  const [extractionStatus, setExtractionStatus] = useState(MANUAL_STATUS);
  const [extractionState, setExtractionState] = useState<LicenseExtractionUiState>("idle");
  const [extractionProgress, setExtractionProgress] = useState<number | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeBusyAttempt, setActiveBusyAttemptState] = useState<BusyAttempt | null>(null);
  const [committed, setCommitted] = useState(false);
  const stateRef = useRef(state);
  const imageUrlRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const imageKeyRef = useRef<string | null>(null);
  const preparedEvidenceRef = useRef<PreparedEvidenceGate | null>(null);
  const extractionAbortRef = useRef<AbortController | null>(null);
  const attemptsRef = useRef<Record<AttemptKind, number>>({ phone: 0, otp: 0, evidence: 0, extraction: 0, kyc: 0, name: 0, preview: 0, create: 0 });
  const activeBusyAttemptRef = useRef<BusyAttempt | null>(null);
  const closingRef = useRef(false);
  const committedRef = useRef(false);
  const previewMutationIdRef = useRef(mutationId("preview"));
  const createMutationIdRef = useRef(mutationId("create"));
  const otpRequestMutationIdRef = useRef(mutationId("otp-request"));
  const otpVerifyMutationIdRef = useRef(mutationId("otp-verify"));
  const kycOperationTailRef = useRef(new Map<string, Promise<void>>());
  const kycClearPendingRef = useRef(new Map<string, Promise<void>>());
  const kycClearBarrierRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { imageUrlRef.current = licenseImageUrl; }, [licenseImageUrl]);
  useEffect(() => { fileRef.current = licenseFile; }, [licenseFile]);

  const sessionIsCurrent = useCallback(
    () => {
      const current = readBoundSession();
      return current.sessionKey === boundSession.sessionKey && current.actorId === boundSession.actorId;
    },
    [boundSession.actorId, boundSession.sessionKey],
  );
  const beginAttempt = useCallback((kind: AttemptKind) => {
    attemptsRef.current[kind] += 1;
    return attemptsRef.current[kind];
  }, []);
  const acceptsAttempt = useCallback((kind: AttemptKind, id: number) => (
    !closingRef.current && attemptsRef.current[kind] === id && sessionIsCurrent()
  ), [sessionIsCurrent]);
  const invalidateAllAttempts = useCallback(() => {
    (Object.keys(attemptsRef.current) as AttemptKind[]).forEach((kind) => { attemptsRef.current[kind] += 1; });
  }, []);
  const setActiveBusyAttempt = useCallback((attempt: BusyAttempt | null) => {
    activeBusyAttemptRef.current = attempt;
    setActiveBusyAttemptState(attempt);
  }, []);
  const beginBusyAttempt = useCallback((kind: BusyAttemptKind) => {
    const id = beginAttempt(kind);
    setActiveBusyAttempt({ kind, id });
    return id;
  }, [beginAttempt, setActiveBusyAttempt]);
  const endBusyAttempt = useCallback((kind: BusyAttemptKind, id: number) => {
    const active = activeBusyAttemptRef.current;
    if (active?.kind !== kind || active.id !== id) return;
    activeBusyAttemptRef.current = null;
    if (!closingRef.current) setActiveBusyAttemptState(null);
  }, []);
  const nextPreviewMutation = useCallback(() => {
    previewMutationIdRef.current = mutationId("preview");
    createMutationIdRef.current = mutationId("create");
  }, []);
  const resetOtpMutationIds = useCallback(() => {
    otpRequestMutationIdRef.current = mutationId("otp-request");
    otpVerifyMutationIdRef.current = mutationId("otp-verify");
  }, []);
  const enqueueTokenKycOperation = useCallback(<T,>(token: string, operation: () => Promise<T>): Promise<T> => {
    const previous = kycOperationTailRef.current.get(token) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    kycOperationTailRef.current.set(token, settled);
    void settled.then(() => {
      if (kycOperationTailRef.current.get(token) === settled) kycOperationTailRef.current.delete(token);
    });
    return result;
  }, []);
  const queueKycClear = useCallback((token: string | null): Promise<void> => {
    if (!token) return Promise.resolve();
    const existing = kycClearPendingRef.current.get(token);
    if (existing) return existing;
    const clientMutationId = mutationId("kyc-clear");
    const pending = enqueueTokenKycOperation(token, async () => {
      if (!sessionIsCurrent() || stateRef.current.onboardingToken !== token) return;
      try {
        await api.customers.onboarding.clearKyc(token, { clientMutationId });
      } catch (error) {
        if (!sessionIsCurrent() || stateRef.current.onboardingToken !== token) return;
        await api.customers.onboarding.clearKyc(token, { clientMutationId });
      }
    });
    kycClearPendingRef.current.set(token, pending);
    kycClearBarrierRef.current.set(token, pending);
    void pending.then(
      () => {
        if (kycClearPendingRef.current.get(token) === pending) kycClearPendingRef.current.delete(token);
        if (kycClearBarrierRef.current.get(token) === pending) kycClearBarrierRef.current.delete(token);
      },
      (error) => {
        if (kycClearPendingRef.current.get(token) === pending) kycClearPendingRef.current.delete(token);
        if (!closingRef.current && sessionIsCurrent() && stateRef.current.onboardingToken === token) {
          setLicenseError(messageOf(error));
        }
      },
    );
    return pending;
  }, [enqueueTokenKycOperation, sessionIsCurrent]);
  const awaitCurrentKycClear = useCallback(async (token: string): Promise<void> => {
    while (true) {
      const pending = kycClearBarrierRef.current.get(token);
      if (!pending) return;
      await pending;
      if (kycClearBarrierRef.current.get(token) === pending) return;
    }
  }, []);
  const invalidateRemoteKyc = useCallback((token: string | null) => {
    attemptsRef.current.kyc += 1;
    void queueKycClear(token);
  }, [queueKycClear]);
  const updatePreparedEvidence = useCallback((value: PreparedEvidenceGate | null) => {
    preparedEvidenceRef.current = value;
    setPreparedEvidence(value);
  }, []);
  const currentPreparedEvidence = useCallback(() => {
    const gate = preparedEvidenceRef.current;
    if (
      !gate
      || gate.file !== fileRef.current
      || gate.imageKey !== imageKeyRef.current
      || gate.attemptId !== attemptsRef.current.evidence
    ) return null;
    return gate;
  }, []);

  const cancelExtraction = useCallback(() => {
    attemptsRef.current.extraction += 1;
    extractionAbortRef.current?.abort();
    extractionAbortRef.current = null;
    setExtractionProgress(null);
    setExtractionState("idle");
  }, []);

  const releaseImage = useCallback(() => {
    const url = imageUrlRef.current;
    imageUrlRef.current = null;
    imageKeyRef.current = null;
    if (url) URL.revokeObjectURL(url);
    setLicenseImageUrl(null);
    setLicenseFile(null);
    fileRef.current = null;
    updatePreparedEvidence(null);
  }, [updatePreparedEvidence]);

  const closeToken = useCallback((token: string | null) => {
    if (!token) return;
    void api.customers.onboarding.close(token).catch(() => undefined);
  }, []);

  const finishClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    invalidateAllAttempts();
    cancelExtraction();
    const token = stateRef.current.onboardingToken;
    releaseImage();
    closeToken(token);
    onClose();
  }, [cancelExtraction, closeToken, invalidateAllAttempts, onClose, releaseImage]);

  useEffect(() => {
    const checkSession = () => {
      if (!sessionIsCurrent()) finishClose();
    };
    window.addEventListener("popstate", checkSession);
    window.addEventListener("storage", checkSession);
    return () => {
      window.removeEventListener("popstate", checkSession);
      window.removeEventListener("storage", checkSession);
    };
  }, [finishClose, sessionIsCurrent]);

  useEffect(() => () => {
    invalidateAllAttempts();
    activeBusyAttemptRef.current = null;
    extractionAbortRef.current?.abort();
    const url = imageUrlRef.current;
    if (url) URL.revokeObjectURL(url);
    if (!closingRef.current && !committedRef.current) closeToken(stateRef.current.onboardingToken);
  }, [closeToken, invalidateAllAttempts]);

  const busy = activeBusyAttempt !== null;
  const dirty = !committed && Boolean(
    state.primaryPhone || state.nameSourceValue || licenseFile
    || Object.values(profileFields).some((value) => value !== "" && value !== "English" && value !== "whatsapp" && value !== "active"),
  );
  const guard = useDirtyCloseGuard({ dirty, blocked: busy, onClose: finishClose });

  const clearLicenseFlow = useCallback(() => {
    cancelExtraction();
    releaseImage();
    setTransform(INITIAL_TRANSFORM);
    setExtractionStatus(MANUAL_STATUS);
    setLicenseError(null);
    setProfileFields(initialProfileFields());
  }, [cancelExtraction, releaseImage]);

  const clearDerivedLicenseProfileFields = useCallback(() => {
    setProfileFields((current) => ({
      ...current,
      ...(stateRef.current.customerType === "organization" ? {} : {
        address: "",
        birthDate: "",
        gender: "",
      }),
    }));
  }, []);

  const changeCustomerType = (value: CustomerType) => {
    if (value === stateRef.current.customerType) return;
    const token = stateRef.current.onboardingToken;
    invalidateAllAttempts();
    clearLicenseFlow();
    setOtpCode("");
    setPhoneError(null);
    setNameError(null);
    setSaveError(null);
    nextPreviewMutation();
    resetOtpMutationIds();
    dispatch({ type: "customerTypeChanged", value });
    closeToken(token);
  };

  const changePhone = (value: string) => {
    const active = activeBusyAttemptRef.current;
    if (active && active.kind !== "phone") return;
    const token = stateRef.current.onboardingToken;
    invalidateAllAttempts();
    clearLicenseFlow();
    setOtpCode("");
    setPhoneError(null);
    setNameError(null);
    setSaveError(null);
    nextPreviewMutation();
    resetOtpMutationIds();
    dispatch({ type: "phoneChanged", value });
    closeToken(token);
  };

  const checkPhone = async () => {
    if (!sessionIsCurrent()) return finishClose();
    const id = beginBusyAttempt("phone");
    setPhoneError(null);
    dispatch({ type: "phoneCheckStarted" });
    try {
      const result = await api.customers.onboarding.previewPhone({
        customerType: stateRef.current.customerType,
        primaryPhone: stateRef.current.primaryPhone,
        clientMutationId: mutationId("phone"),
      });
      if (!acceptsAttempt("phone", id)) {
        if (result.status === "clear") closeToken(result.onboardingToken);
        return;
      }
      if (result.status === "duplicate") {
        dispatch({ type: "phoneDuplicate", phoneE164: result.phoneE164, matches: result.matches });
      } else {
        resetOtpMutationIds();
        dispatch({ type: "phoneCleared", token: result.onboardingToken, phoneE164: result.phoneE164 });
      }
    } catch (error) {
      if (acceptsAttempt("phone", id)) setPhoneError(messageOf(error));
    } finally {
      endBusyAttempt("phone", id);
    }
  };

  const sendOtp = async () => {
    const token = stateRef.current.onboardingToken;
    if (!token || !sessionIsCurrent()) return;
    const id = beginBusyAttempt("otp");
    setPhoneError(null);
    try {
      const challenge = await api.customers.onboarding.requestOtp(token, { clientMutationId: otpRequestMutationIdRef.current });
      if (acceptsAttempt("otp", id)) {
        dispatch({ type: "otpRequested", challenge });
        nextPreviewMutation();
      }
    } catch (error) {
      if (acceptsAttempt("otp", id)) setPhoneError(messageOf(error));
    } finally {
      endBusyAttempt("otp", id);
    }
  };

  const verifyOtp = async () => {
    const current = stateRef.current;
    if (!current.onboardingToken || !current.otpChallenge || !sessionIsCurrent()) return;
    const id = beginBusyAttempt("otp");
    setPhoneError(null);
    try {
      const verification = await api.customers.onboarding.verifyOtp(current.onboardingToken, {
        otpChallengeId: current.otpChallenge.otpChallengeId,
        code: otpCode,
        clientMutationId: otpVerifyMutationIdRef.current,
      });
      if (acceptsAttempt("otp", id)) {
        dispatch({ type: "otpVerified", verification });
        nextPreviewMutation();
      }
    } catch (error) {
      if (acceptsAttempt("otp", id)) setPhoneError(messageOf(error));
    } finally {
      endBusyAttempt("otp", id);
    }
  };

  const runExtraction = useCallback(async () => {
    const file = fileRef.current;
    const evidenceGate = currentPreparedEvidence();
    if (!file || !evidenceGate || licenseMode !== "ai" || !sessionIsCurrent()) return;
    invalidateRemoteKyc(stateRef.current.onboardingToken);
    dispatch({ type: "licenseAttestationChanged", value: false });
    dispatch({ type: "nameSourceChanged", value: "" });
    clearDerivedLicenseProfileFields();
    nextPreviewMutation();
    cancelExtraction();
    const id = beginAttempt("extraction");
    const controller = new AbortController();
    extractionAbortRef.current = controller;
    setExtractionProgress(0);
    setExtractionState("running");
    setLicenseError(null);
    try {
      const client = licenseExtractionClientFactory();
      const result = await client.extract({
        file,
        transform,
        signal: controller.signal,
        onProgress: (percent) => {
          if (acceptsAttempt("extraction", id)) setExtractionProgress(Math.round(percent));
        },
      });
      if (!acceptsAttempt("extraction", id)) return;
      setExtractionStatus(result.status);
      dispatch({ type: "licenseExtractionCompleted", result });
      setExtractionProgress(null);
      setExtractionState("success");
    } catch {
      if (!acceptsAttempt("extraction", id)) return;
      setExtractionStatus(MANUAL_STATUS);
      setExtractionProgress(null);
      setExtractionState("error");
    } finally {
      if (extractionAbortRef.current === controller) extractionAbortRef.current = null;
    }
  }, [acceptsAttempt, beginAttempt, cancelExtraction, clearDerivedLicenseProfileFields, currentPreparedEvidence, invalidateRemoteKyc, licenseExtractionClientFactory, licenseMode, nextPreviewMutation, sessionIsCurrent, transform]);

  const prepareEvidence = useCallback(async (file: File, imageKey: string) => {
    const id = beginAttempt("evidence");
    updatePreparedEvidence(null);
    let decodedImage: Awaited<ReturnType<typeof assertLicenseImageInput>> | null = null;
    try {
      decodedImage = await assertLicenseImageInput(file, (candidate) => createImageBitmap(candidate));
      const evidence = await prepareDriverLicenseEvidence(file);
      if (
        acceptsAttempt("evidence", id)
        && fileRef.current === file
        && imageKeyRef.current === imageKey
      ) {
        updatePreparedEvidence({ evidence, file, imageKey, attemptId: id });
      }
    } catch (error) {
      if (
        acceptsAttempt("evidence", id)
        && fileRef.current === file
        && imageKeyRef.current === imageKey
      ) {
        updatePreparedEvidence(null);
        setLicenseError(messageOf(error));
      }
    } finally {
      try { decodedImage?.close?.(); } catch { /* decoded image is no longer needed */ }
    }
  }, [acceptsAttempt, beginAttempt, updatePreparedEvidence]);

  const changeLicenseFile = (file: File | null) => {
    const token = stateRef.current.onboardingToken;
    invalidateAllAttempts();
    void queueKycClear(token);
    cancelExtraction();
    releaseImage();
    setTransform(INITIAL_TRANSFORM);
    setExtractionStatus(MANUAL_STATUS);
    setLicenseError(null);
    setNameError(null);
    setSaveError(null);
    clearDerivedLicenseProfileFields();
    nextPreviewMutation();
    const imageKey = file ? `${file.name}:${file.size}:${file.lastModified}` : null;
    imageKeyRef.current = imageKey;
    dispatch({ type: "licenseImageChanged", imageKey });
    if (!file || !imageKey) return;
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setLicenseError("仅支持 JPEG、PNG 驾驶证正面图片，不支持 PDF");
      return;
    }
    const url = URL.createObjectURL(file);
    imageUrlRef.current = url;
    fileRef.current = file;
    setLicenseFile(file);
    setLicenseImageUrl(url);
    void prepareEvidence(file, imageKey);
  };

  const changeLicenseMode = (mode: "ai" | "manual") => {
    if (mode === licenseMode) return;
    invalidateRemoteKyc(stateRef.current.onboardingToken);
    setLicenseMode(mode);
    cancelExtraction();
    dispatch({ type: "licenseAttestationChanged", value: false });
    dispatch({ type: "nameSourceChanged", value: "" });
    setExtractionStatus(MANUAL_STATUS);
    setLicenseError(null);
    setNameError(null);
    setSaveError(null);
    clearDerivedLicenseProfileFields();
    nextPreviewMutation();
  };

  const changeTransform = (nextTransform: LicenseImageTransform) => {
    invalidateRemoteKyc(stateRef.current.onboardingToken);
    setTransform(nextTransform);
    cancelExtraction();
    dispatch({ type: "licenseImageChanged", imageKey: stateRef.current.licenseImageKey });
    setExtractionStatus(MANUAL_STATUS);
    setLicenseError(null);
    setNameError(null);
    setSaveError(null);
    clearDerivedLicenseProfileFields();
    nextPreviewMutation();
  };

  const changeLicenseField = (field: LicenseExtractionField, value: string) => {
    invalidateRemoteKyc(stateRef.current.onboardingToken);
    cancelExtraction();
    dispatch({ type: "licenseFieldChanged", field, value });
    setExtractionStatus((current) => ({ ...current, [field]: value ? "extracted" : "manual_required" }));
    setNameError(null);
    setSaveError(null);
    clearDerivedLicenseProfileFields();
    nextPreviewMutation();
  };

  const changeAttestation = async (checked: boolean) => {
    dispatch({ type: "licenseAttestationChanged", value: checked });
    nextPreviewMutation();
    if (!checked) {
      invalidateRemoteKyc(stateRef.current.onboardingToken);
      return;
    }
    const current = stateRef.current;
    const evidenceGate = currentPreparedEvidence();
    const profile = current.licenseProfile;
    if (!current.onboardingToken || !evidenceGate || !profile.name.trim() || !profile.birthDate || !profile.sex || !profile.address.trim()) {
      dispatch({ type: "licenseAttestationChanged", value: false });
      setLicenseError("请先上传驾驶证并完整核对姓名、出生日期、性别和地址");
      return;
    }
    const id = beginBusyAttempt("kyc");
    setLicenseError(null);
    try {
      await enqueueTokenKycOperation(current.onboardingToken, async () => {
        await awaitCurrentKycClear(current.onboardingToken!);
        if (!acceptsAttempt("kyc", id)) return;
        const submission = await api.customers.onboarding.submitKyc(current.onboardingToken!, {
          frontAsset: evidenceGate.evidence,
          profile: { name: profile.name.trim(), birthDate: profile.birthDate, sex: profile.sex as "M" | "F", address: profile.address.trim() },
          clientMutationId: mutationId("kyc-submit"),
        });
        if (!acceptsAttempt("kyc", id)) return;
        dispatch({ type: "kycSubmitted", submission });
        const confirmation = await api.customers.onboarding.verifyKyc(current.onboardingToken!, {
          kycDraftId: submission.kycDraftId,
          attested: true,
          clientMutationId: mutationId("kyc-verify"),
        });
        if (!acceptsAttempt("kyc", id)) return;
        dispatch({ type: "kycVerified", confirmation });
        dispatch({ type: "nameSourceChanged", value: confirmation.profile.name });
        if (current.customerType === "individual") {
          setProfileFields((fields) => ({
            ...fields,
            address: confirmation.profile.address,
            birthDate: confirmation.profile.birthDate,
            gender: confirmation.profile.sex === "M" ? "男" : "女",
          }));
        }
        nextPreviewMutation();
      });
    } catch (error) {
      if (acceptsAttempt("kyc", id) && stateRef.current.onboardingToken === current.onboardingToken) {
        dispatch({ type: "licenseAttestationChanged", value: false });
        invalidateRemoteKyc(current.onboardingToken);
        setLicenseError(messageOf(error));
      }
    } finally {
      endBusyAttempt("kyc", id);
    }
  };

  const changeName = (value: string) => {
    dispatch({ type: "nameSourceChanged", value });
    setNameError(null);
    setSaveError(null);
    nextPreviewMutation();
  };

  const confirmName = async () => {
    const value = stateRef.current.nameSourceValue;
    if (!value.trim() || !sessionIsCurrent()) return;
    const id = beginBusyAttempt("name");
    setNameError(null);
    try {
      const preview = await api.customers.previewName(value);
      if (acceptsAttempt("name", id)) dispatch({ type: "nameTransliterationConfirmed", preview });
    } catch (error) {
      if (acceptsAttempt("name", id)) setNameError(messageOf(error));
    } finally {
      endBusyAttempt("name", id);
    }
  };

  const changeProfileField = <K extends keyof OnboardingProfileFields>(field: K, value: OnboardingProfileFields[K]) => {
    setProfileFields((current) => ({ ...current, [field]: value }));
    dispatch({ type: "profileChanged" });
    setSaveError(null);
    nextPreviewMutation();
  };

  const customerDraft = (): CustomerDraftInput => ({
    customerType: stateRef.current.customerType,
    organizationName: stateRef.current.customerType === "organization" ? profileFields.organizationName.trim() || null : null,
    nameSourceValue: stateRef.current.nameSourceValue.trim() || null,
    nameTransliterationToken: stateRef.current.namePreview?.confirmationToken ?? null,
    primaryContactRole: stateRef.current.customerType === "organization" ? profileFields.primaryContactRole.trim() || null : null,
    salutation: profileFields.salutation.trim() || null,
    language: profileFields.language.trim() || null,
    primaryPhone: stateRef.current.normalizedPhone,
    secondaryPhone: profileFields.secondaryPhone.trim() || null,
    whatsapp: profileFields.whatsapp.trim() || null,
    email: profileFields.email.trim() || null,
    preferredChannel: profileFields.preferredChannel,
    address: profileFields.address.trim() || null,
    gender: profileFields.gender.trim() || null,
    birthDate: profileFields.birthDate || null,
    trn: profileFields.trn.trim() || null,
    status: profileFields.status,
    reason: profileFields.reason.trim() || null,
  });

  const previewCustomer = async () => {
    const current = stateRef.current;
    if (!current.onboardingToken || !current.namePreview || !sessionIsCurrent()) return;
    const id = beginBusyAttempt("preview");
    setSaveError(null);
    try {
      await awaitCurrentKycClear(current.onboardingToken);
      if (!acceptsAttempt("preview", id)) return;
      const preview = await api.customers.onboarding.preview(current.onboardingToken, {
        customer: customerDraft(),
        clientMutationId: previewMutationIdRef.current,
      });
      if (acceptsAttempt("preview", id)) {
        if (preview.status === "phone_conflict") dispatch({ type: "customerPhoneConflict", matches: preview.matches });
        else dispatch({ type: "customerPreviewed", preview });
      }
    } catch (error) {
      if (acceptsAttempt("preview", id)) setSaveError(messageOf(error));
    } finally {
      endBusyAttempt("preview", id);
    }
  };

  const createCustomer = async () => {
    const current = stateRef.current;
    if (!current.onboardingToken || !current.customerPreview || !sessionIsCurrent()) return;
    const id = beginBusyAttempt("create");
    setSaveError(null);
    try {
      await awaitCurrentKycClear(current.onboardingToken);
      if (!acceptsAttempt("create", id)) return;
      const created = await api.customers.onboarding.create(current.onboardingToken, {
        previewToken: current.customerPreview.previewToken,
        clientMutationId: createMutationIdRef.current,
        customer: current.customerPreview.input,
      });
      if (!acceptsAttempt("create", id)) return;
      committedRef.current = true;
      setCommitted(true);
      releaseImage();
      await onSaved(created);
    } catch (error) {
      if (acceptsAttempt("create", id)) {
        if (error instanceof ApiError
          && error.status === 409
          && error.code === "CUSTOMER_ONBOARDING_SOURCE_REVISION_CONFLICT") {
          dispatch({ type: "customerPreviewInvalidated" });
          nextPreviewMutation();
        }
        setSaveError(messageOf(error));
      }
    } finally {
      endBusyAttempt("create", id);
    }
  };

  const profileEnabled = state.onboardingToken !== null && Boolean(state.primaryPhone.trim());
  const previewEnabled = profileEnabled
    && Boolean(state.namePreview)
    && (state.customerType === "individual" || Boolean(profileFields.organizationName.trim()));
  const createEnabled = Boolean(state.customerPreview) && state.previewPhoneMatches.length === 0;
  const extractionReady = preparedEvidence !== null
    && currentPreparedEvidence() === preparedEvidence;

  return (
    <Dialog open title="新建客户" onClose={guard.requestClose} dataTestId="customer-onboarding-dialog" closeTestId="onboarding-close" closeLabel="关闭新建客户" mobileFullscreen className="sm:w-[min(1180px,calc(100vw-2rem))] lg:max-h-[calc(100vh-2rem)]">
      {guard.confirmationOpen ? (
        <DiscardConfirmation continueButtonRef={guard.continueButtonRef} onContinue={guard.continueEditing} onDiscard={guard.discardChanges} testIdPrefix="onboarding" />
      ) : (
        <div className="min-h-full bg-[var(--wh-page-bg)] dark:bg-slate-950/50">
          <div className="border-b border-line bg-white px-4 py-3 dark:bg-slate-800 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-soft dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-white"><UserPlus size={13} aria-hidden />现场建档</span>
              <span>号码查重与 OTP</span><span aria-hidden>→</span><span>证件核对</span><span aria-hidden>→</span><span>姓名与最终预览</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-soft dark:text-slate-400">号码归属冲突会阻止建档；OTP 和驾驶证可稍后补齐，预览会如实列出提醒。</p>
          </div>
          <div className="space-y-4 p-3 pb-28 sm:space-y-5 sm:p-6 sm:pb-32">
            <OnboardingPhoneStep state={state} busy={busy} phoneChangeDisabled={activeBusyAttempt !== null && activeBusyAttempt.kind !== "phone"} error={phoneError} otpCode={otpCode} onCustomerTypeChange={changeCustomerType} onPhoneChange={changePhone} onCheckPhone={() => void checkPhone()} onSendOtp={() => void sendOtp()} onOtpCodeChange={setOtpCode} onVerifyOtp={() => void verifyOtp()} />
            <OnboardingLicenseStep subjectLabel={state.customerType === "organization" ? "企业主要联系人" : "客户"} optional state={state} disabled={!state.onboardingToken} busy={busy} mode={licenseMode} imageUrl={licenseImageUrl} extractionReady={extractionReady} transform={transform} extractionStatus={extractionStatus} extractionState={extractionState} extractionProgress={extractionProgress} error={licenseError} onModeChange={changeLicenseMode} onFileChange={changeLicenseFile} onTransformChange={changeTransform} onExtract={() => void runExtraction()} onFieldChange={changeLicenseField} onAttestationChange={(checked) => void changeAttestation(checked)} />
            <OnboardingProfileStep state={state} fields={profileFields} customers={customers} disabled={!profileEnabled} busy={busy} nameError={nameError} onNameChange={changeName} onConfirmName={() => void confirmName()} onFieldChange={changeProfileField} />
            {saveError ? <p data-testid="onboarding-save-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{saveError}</p> : null}
          </div>
          <footer data-testid="onboarding-footer" className="sticky bottom-0 z-20 flex flex-col-reverse gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur-xl dark:bg-slate-800/95 sm:flex-row sm:items-center sm:justify-end sm:px-6">
            <button type="button" disabled={busy} onClick={guard.requestClose} data-testid="onboarding-cancel" className="min-h-11 rounded-xl border border-line bg-white px-4 text-xs font-bold text-ink-soft disabled:opacity-40 dark:bg-slate-900 dark:text-slate-300">取消</button>
            <button type="button" disabled={busy || !previewEnabled} onClick={() => void previewCustomer()} data-testid="onboarding-preview" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-primary bg-white px-4 text-xs font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900"><ClipboardCheck size={15} aria-hidden />检查并预览</button>
            <button type="button" disabled={busy || committed || !createEnabled} onClick={() => void createCustomer()} data-testid="onboarding-create" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={15} aria-hidden />{committed ? "已创建" : busy ? "处理中…" : "创建客户档案"}</button>
          </footer>
        </div>
      )}
    </Dialog>
  );
}
