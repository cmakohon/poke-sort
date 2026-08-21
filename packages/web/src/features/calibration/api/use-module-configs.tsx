import {
  modulesQueryOptions,
  saveModuleConfig,
} from "@/features/calibration/api/module-configs";
import type { ModuleConfigsContextValue } from "@/features/calibration/types";
import { useOrg } from "@/hooks/use-org";
import { useSerial } from "@/features/scanner/api/use-serial";
import {
  DEFAULT_CALIBRATION,
  ModuleConfig,
  ServoCalibration,
} from "@poke-sort/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const ModuleConfigsContext = createContext<ModuleConfigsContextValue | null>(
  null,
);

function defaultConfigs(): ModuleConfig[] {
  return ([1, 2, 3] as const).map((n) => ({
    moduleNumber: n,
    calibrated: false,
    calibration: { ...DEFAULT_CALIBRATION },
  }));
}

export function ModuleConfigsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("calibration");
  const queryClient = useQueryClient();
  const { activeOrg } = useOrg();
  const { request, requestLatest, registerPreTestHook } = useSerial();

  const { data: configs = defaultConfigs() } = useQuery({ ...modulesQueryOptions, enabled: !!activeOrg });

  /**
   * Re-push every module's stored calibration to the sorter.
   *
   * The firmware keeps calibration in RAM only, so anything that changes the
   * stored values behind the per-module save mutation has to say so out loud:
   * on connect and after a watchdog reboot (via the pre-test hook below), and
   * after a calibration file is imported, which rewrites all three rows at once
   * without going through `saveConfig`.
   *
   * Returns whether the sorter now holds a real calibration for all three
   * modules — the caller must not run the self-test unless it does.
   */
  const syncToDevice = useCallback(async () => {
    // staleTime on the shared options is Infinity, which is right for the
    // screens reading this but would make fetchQuery a cache hit that never
    // re-reads. A reconnect has to see what is actually saved: the values may
    // have changed, and a cached defaults-fallback from a fetch that raced
    // startup would otherwise be re-pushed for the rest of the session.
    const fresh = await queryClient.fetchQuery({
      ...modulesQueryOptions,
      staleTime: 0,
    });
    let allSynced = true;
    for (const config of fresh) {
      // Never drive an uncalibrated module. It carries DEFAULT_CALIBRATION as a
      // placeholder for the calibration screen, and those positions span nearly
      // the whole travel range — pushing them detaches servo arms.
      if (!config.calibrated) {
        allSynced = false;
        toast.error(
          t("useModuleConfigs.toasts.notCalibrated", {
            module: config.moduleNumber,
          }),
          { description: t("useModuleConfigs.toasts.notCalibratedDescription") },
        );
        continue;
      }
      const { sent, response } = await request(
        JSON.stringify({
          setConfig: { module: config.moduleNumber, ...config.calibration },
        }),
      );
      if (!sent || !response) {
        allSynced = false;
        toast.error(
          t("useModuleConfigs.toasts.notSynced", {
            module: config.moduleNumber,
          }),
          { description: t("useModuleConfigs.toasts.noResponse") },
        );
        continue;
      }
      try {
        const parsed = JSON.parse(response);
        if (parsed?.error) {
          allSynced = false;
          toast.error(
            t("useModuleConfigs.toasts.notSynced", {
              module: config.moduleNumber,
            }),
            { description: String(parsed.error) },
          );
        }
      } catch {
        allSynced = false;
        toast.error(
          t("useModuleConfigs.toasts.notSynced", {
            module: config.moduleNumber,
          }),
          {
            description: t("useModuleConfigs.toasts.unexpectedResponse", {
              response,
            }),
          },
        );
      }
    }
    return allSynced;
  }, [queryClient, request, t]);

  useEffect(() => {
    return registerPreTestHook(syncToDevice);
  }, [registerPreTestHook, syncToDevice]);

  const saveConfigMutation = useMutation({
    mutationFn: ({
      moduleNumber,
      calibration,
    }: {
      moduleNumber: 1 | 2 | 3;
      calibration: ServoCalibration;
    }) => saveModuleConfig(moduleNumber, calibration),
    onMutate: async ({ moduleNumber, calibration }) => {
      await queryClient.cancelQueries({ queryKey: ["modules"] });
      const previous = queryClient.getQueryData<ModuleConfig[]>(["modules"]);
      queryClient.setQueryData<ModuleConfig[]>(
        ["modules"],
        (old = defaultConfigs()) =>
          old.map((c) =>
            c.moduleNumber === moduleNumber
              ? { ...c, calibration, calibrated: true }
              : c,
          ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(["modules"], context.previous);
      toast.error(t("useModuleConfigs.toasts.saveFailed"));
    },
    onSuccess: (result, { moduleNumber, calibration }) => {
      if (result.success && result.data) {
        queryClient.setQueryData(["modules"], result.data);
        void request(
          JSON.stringify({ setConfig: { module: moduleNumber, ...calibration } }),
        );
      }
    },
  });

  const saveConfig = useCallback(
    async (moduleNumber: 1 | 2 | 3, calibration: ServoCalibration) => {
      await saveConfigMutation.mutateAsync({ moduleNumber, calibration });
    },
    [saveConfigMutation],
  );

  const moveServo = useCallback(
    (
      module: 1 | 2 | 3,
      servo: "bottom" | "paddle" | "pusher",
      value: number,
    ) => {
      // Coalesced per servo: a drag produces values faster than the 9600-baud
      // round trip drains them, so while one move is on the wire only the
      // latest value stays queued — and its reply is consumed, never orphaned.
      void requestLatest(
        `servo:${module}:${servo}`,
        JSON.stringify({ servo, module, value }),
      );
    },
    [requestLatest],
  );

  return (
    <ModuleConfigsContext value={{ configs, saveConfig, moveServo, syncToDevice }}>
      {children}
    </ModuleConfigsContext>
  );
}

export function useModuleConfigs() {
  const context = useContext(ModuleConfigsContext);
  if (!context) {
    throw new Error(
      "useModuleConfigs must be used within a ModuleConfigsProvider",
    );
  }
  return context;
}
