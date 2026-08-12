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

  useEffect(() => {
    return registerPreTestHook(async () => {
      const fresh = await queryClient.fetchQuery(modulesQueryOptions);
      for (const config of fresh) {
        const { sent, response } = await request(
          JSON.stringify({
            setConfig: { module: config.moduleNumber, ...config.calibration },
          }),
        );
        if (!sent || !response) {
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
            toast.error(
              t("useModuleConfigs.toasts.notSynced", {
                module: config.moduleNumber,
              }),
              { description: String(parsed.error) },
            );
          }
        } catch {
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
    });
  }, [registerPreTestHook, queryClient, request, t]);

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
            c.moduleNumber === moduleNumber ? { ...c, calibration } : c,
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
    <ModuleConfigsContext value={{ configs, saveConfig, moveServo }}>
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
