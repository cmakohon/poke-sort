import {
  feederQueryOptions,
  saveFeederConfig,
} from "@/features/calibration/api/feeder-config";
import { useOrg } from "@/hooks/use-org";
import { useSerial } from "@/features/scanner/api/use-serial";
import {
  DEFAULT_FEEDER_CALIBRATION,
  type FeederCalibration,
} from "@poke-sort/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface FeederConfigContextValue {
  feederConfig: FeederCalibration;
  saveConfig: (calibration: FeederCalibration) => Promise<void>;
  previewSpeed: (value: number) => void;
  /**
   * Re-push the stored calibration to the sorter. Only call while connected.
   * Resolves false when the sorter did not confirm it.
   */
  syncToDevice: () => Promise<boolean>;
}

const FeederConfigContext = createContext<FeederConfigContextValue | null>(null);

export function FeederConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("calibration");
  const queryClient = useQueryClient();
  const { activeOrg } = useOrg();
  const { request, requestLatest, registerPreTestHook } = useSerial();

  const { data: feederConfig = { ...DEFAULT_FEEDER_CALIBRATION } } =
    useQuery({ ...feederQueryOptions, enabled: !!activeOrg });

  /**
   * Re-push the stored feeder timings to the sorter — see the same callback in
   * use-module-configs.tsx. An import rewrites the row without going through
   * `saveConfig`, so it has to ask for this explicitly.
   */
  const syncToDevice = useCallback(async () => {
    // staleTime: 0 overrides the shared options' Infinity — see the same
    // override in use-module-configs.tsx for why a reconnect cannot be served
    // from cache here.
    const fresh = await queryClient.fetchQuery({
      ...feederQueryOptions,
      staleTime: 0,
    });
    const { sent, response } = await request(
      JSON.stringify({ setFeederConfig: fresh }),
    );
    if (!sent || !response) {
      toast.error(t("useFeederConfig.toasts.notSynced"), {
        description: t("useFeederConfig.toasts.noResponse"),
      });
      return false;
    }
    try {
      const parsed = JSON.parse(response);
      if (parsed?.error) {
        toast.error(t("useFeederConfig.toasts.notSynced"), {
          description: String(parsed.error),
        });
        return false;
      }
    } catch {
      toast.error(t("useFeederConfig.toasts.notSynced"), {
        description: t("useFeederConfig.toasts.unexpectedResponse", {
          response,
        }),
      });
      return false;
    }
    return true;
  }, [queryClient, request, t]);

  useEffect(() => {
    // Reports success unconditionally, unlike the module-calibration hook. The
    // boolean gates whether it is safe to stroke the arms, and feeder timings
    // do not move them — so one garbled setFeederConfig reply must not leave
    // the sorter permanently un-ready, which on the reboot path would also
    // block the readIR/clearDevice recovery and strand a card in the
    // mechanism. syncToDevice raises its own toast when the push fails.
    return registerPreTestHook(async () => {
      await syncToDevice();
      return true;
    });
  }, [registerPreTestHook, syncToDevice]);

  const saveConfigMutation = useMutation({
    mutationFn: (calibration: FeederCalibration) =>
      saveFeederConfig(calibration),
    onMutate: async (calibration) => {
      await queryClient.cancelQueries({ queryKey: ["feeder"] });
      const previous = queryClient.getQueryData<FeederCalibration>(["feeder"]);
      queryClient.setQueryData<FeederCalibration>(["feeder"], calibration);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(["feeder"], context.previous);
      toast.error(t("useFeederConfig.toasts.saveFailed"));
    },
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(["feeder"], result.data);
        void request(JSON.stringify({ setFeederConfig: result.data }));
      }
    },
  });

  const saveConfig = useCallback(
    async (calibration: FeederCalibration) => {
      await saveConfigMutation.mutateAsync(calibration);
    },
    [saveConfigMutation],
  );

  const previewSpeed = useCallback(
    (value: number) => {
      // Coalesced like moveServo: only the latest slider value stays queued
      // while an exchange is on the wire, and the reply is consumed.
      void requestLatest("feederValue", JSON.stringify({ feederValue: value }));
    },
    [requestLatest],
  );

  return (
    <FeederConfigContext value={{ feederConfig, saveConfig, previewSpeed, syncToDevice }}>
      {children}
    </FeederConfigContext>
  );
}

export function useFeederConfig() {
  const context = useContext(FeederConfigContext);
  if (!context) {
    throw new Error("useFeederConfig must be used within a FeederConfigProvider");
  }
  return context;
}
