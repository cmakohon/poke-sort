import type { BinConfigsContextValue } from "@/features/bins/types";
import {
  BIN_COUNT,
  BinConfig,
  BinRuleGroup,
  BinSet,
  POKEMON_FIELD_DEFINITIONS,
} from "@poke-sort/shared";

import {
  activateSet as activateSetAction,
  binsQueryOptions,
  clearBinConfig as clearBinConfigAction,
  createSet as createSetAction,
  deleteSet as deleteSetAction,
  renameSet as renameSetAction,
  saveBinConfig as saveBinConfigAction,
  saveSet as saveSetAction,
} from "@/features/bins/api/sort-bins";
import { useCollections } from "@/features/collections/api/use-collections";
import { gamesQueryOptions } from "@/features/games/api/games";
import { useOrg } from "@/hooks/use-org";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

function emptyRules(): BinRuleGroup {
  return { id: crypto.randomUUID(), combinator: "and", conditions: [] };
}

function createEmptyConfig(binNumber: number): BinConfig {
  return { guid: crypto.randomUUID(), binNumber, rules: emptyRules() };
}

function configsFromSet(set: BinSet | undefined): BinConfig[] {
  const filled: BinConfig[] = [];
  for (let i = 1; i <= BIN_COUNT; i++) {
    const existing = set?.bins.find((c) => c.binNumber === i);
    filled.push(existing ?? createEmptyConfig(i));
  }
  return filled;
}

const BinConfigsContext = createContext<BinConfigsContextValue | null>(null);

export function BinConfigsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation("bins");
  const queryClient = useQueryClient();
  const { activeOrg } = useOrg();
  const { activeCollection } = useCollections();
  const [selectedBin, setSelectedBin] = useState(1);

  const { data: allSets = [] } = useQuery({
    ...binsQueryOptions,
    enabled: !!activeOrg,
  });

  // A sort belongs to the machine, not to a collection: the machine runs one
  // configuration at a time and the rest are saved presets. It used to be
  // derived through whichever collection was open — collection -> game -> the
  // active set for that game — which read as per-collection while behaving
  // globally, so two collections could never differ anyway.
  //
  // The game is still needed, but only to know which catalog the facet-backed
  // pickers (rarity, set, series) read their options from. That comes from the
  // game itself now rather than from a collection.
  const { data: games = [] } = useQuery({
    ...gamesQueryOptions,
    enabled: !!activeOrg,
  });
  const game = games.find((g) => g.isActive) ?? games[0];
  const gameKey = game?.key;
  const lang = activeCollection?.lang ?? "en";
  const fieldDefinitions = game?.fieldDefinitions ?? POKEMON_FIELD_DEFINITIONS;

  const sets = allSets;

  const selectedSet = useMemo(
    () => sets.find((s) => s.isActive) ?? sets[0],
    [sets],
  );

  const configs = useMemo(() => configsFromSet(selectedSet), [selectedSet]);

  const hasCatchAll = useMemo(
    () => configs.some((c) => c.isCatchAll),
    [configs],
  );

  const selectedConfig =
    configs.find((c) => c.binNumber === selectedBin) ?? configs[0];

  // --- Bin-level mutations ---

  const saveBinMutation = useMutation({
    mutationFn: saveBinConfigAction,
    onMutate: async ({ binNumber, rules, isCatchAll }) => {
      await queryClient.cancelQueries({ queryKey: ["bins"] });
      const previous = queryClient.getQueryData<BinSet[]>(["bins"]);
      queryClient.setQueryData<BinSet[]>(["bins"], (old = []) =>
        old.map((set) => {
          if (!set.isActive) return set;
          const idx = set.bins.findIndex((b) => b.binNumber === binNumber);
          const updated: BinConfig = {
            guid: idx >= 0 ? set.bins[idx].guid : crypto.randomUUID(),
            binNumber,
            rules: rules!,
            isCatchAll,
          };
          return {
            ...set,
            bins:
              idx >= 0
                ? set.bins.map((b, i) => (i === idx ? updated : b))
                : [...set.bins, updated],
          };
        }),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(["bins"], context.previous);
      toast.error(t("useBinConfigs.toasts.saveBinFailed"));
    },
    onSuccess: (result) => {
      if (!result.success) {
        queryClient.invalidateQueries({ queryKey: ["bins"] });
        return;
      }
      if (result.data) {
        const confirmed = result.data;
        queryClient.setQueryData<BinSet[]>(["bins"], (old = []) =>
          old.map((set) =>
            set.isActive
              ? {
                  ...set,
                  bins: set.bins.map((b) =>
                    b.binNumber === confirmed.binNumber ? confirmed : b,
                  ),
                }
              : set,
          ),
        );
      }
    },
  });

  const clearBinMutation = useMutation({
    mutationFn: (binNumber: number) =>
      clearBinConfigAction(binNumber),
    onMutate: async (binNumber) => {
      await queryClient.cancelQueries({ queryKey: ["bins"] });
      const previous = queryClient.getQueryData<BinSet[]>(["bins"]);
      queryClient.setQueryData<BinSet[]>(["bins"], (old = []) =>
        old.map((set) =>
          set.isActive
            ? {
                ...set,
                bins: set.bins.filter((b) => b.binNumber !== binNumber),
              }
            : set,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(["bins"], context.previous);
      toast.error(t("useBinConfigs.toasts.clearBinFailed"));
    },
  });

  // --- Set-level mutations ---

  const activateSetMutation = useMutation({
    mutationFn: activateSetAction,
    onSuccess: (result) => {
      if (result.success && result.data) {
        setSelectedBin(1);
        queryClient.setQueryData(["bins"], result.data);
      }
    },
    onError: () => toast.error(t("useBinConfigs.toasts.activateSetFailed")),
  });

  const createSetMutation = useMutation({
    mutationFn: (name: string) =>
      createSetAction(name, undefined),
    onSuccess: (result) => {
      if (result.success && result.data) {
        setSelectedBin(1);
        queryClient.setQueryData(["bins"], result.data);
      }
    },
    onError: () => toast.error(t("useBinConfigs.toasts.createSetFailed")),
  });

  const saveSetMutation = useMutation({
    mutationFn: (name: string) => saveSetAction(name),
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(["bins"], result.data);
      }
    },
    onError: () => toast.error(t("useBinConfigs.toasts.saveSetFailed")),
  });

  const renameSetMutation = useMutation({
    mutationFn: ({ guid, name }: { guid: string; name: string }) =>
      renameSetAction(guid, name),
    onSuccess: (result) => {
      if (result.success && result.data) {
        queryClient.setQueryData(["bins"], result.data);
      }
    },
    onError: () => toast.error(t("useBinConfigs.toasts.renameSetFailed")),
  });

  const deleteSetMutation = useMutation({
    mutationFn: deleteSetAction,
    onSuccess: (result) => {
      if (result.success && result.data) {
        setSelectedBin(1);
        queryClient.setQueryData(["bins"], result.data);
      }
    },
    onError: () => toast.error(t("useBinConfigs.toasts.deleteSetFailed")),
  });

  const isPending = saveBinMutation.isPending || clearBinMutation.isPending;
  const isActivating = activateSetMutation.isPending;
  const isPresetMutating =
    activateSetMutation.isPending ||
    createSetMutation.isPending ||
    saveSetMutation.isPending ||
    renameSetMutation.isPending ||
    deleteSetMutation.isPending;

  const save = useCallback(
    (binNumber: number, rules: BinRuleGroup, isCatchAll?: boolean) => {
      saveBinMutation.mutate({
        binNumber,
        rules,
        isCatchAll,
      });
    },
    [saveBinMutation],
  );

  const clear = useCallback(
    (binNumber: number) => {
      clearBinMutation.mutate(binNumber);
    },
    [clearBinMutation],
  );

  const activateSetFn = useCallback(
    async (guid: string) => {
      await activateSetMutation.mutateAsync(guid);
    },
    [activateSetMutation],
  );

  const createSetFn = useCallback(
    async (name: string) => {
      await createSetMutation.mutateAsync(name);
    },
    [createSetMutation],
  );

  const saveSetFn = useCallback(
    async (name: string) => {
      await saveSetMutation.mutateAsync(name);
    },
    [saveSetMutation],
  );

  const renameSetFn = useCallback(
    async (guid: string, name: string) => {
      await renameSetMutation.mutateAsync({ guid, name });
    },
    [renameSetMutation],
  );

  const deleteSetFn = useCallback(
    async (guid: string) => {
      await deleteSetMutation.mutateAsync(guid);
    },
    [deleteSetMutation],
  );

  return (
    <BinConfigsContext
      value={{
        configs,
        sets,
        fieldDefinitions,
        gameKey,
        lang,
        isPending,
        isActivating,
        isPresetMutating,
        hasCatchAll,
        selectedBin,
        setSelectedBin,
        selectedConfig,
        selectedSet,
        save,
        clear,
        activateSet: activateSetFn,
        createSet: createSetFn,
        saveSet: saveSetFn,
        renameSet: renameSetFn,
        deleteSet: deleteSetFn,
      }}
    >
      {children}
    </BinConfigsContext>
  );
}

export function useBinConfigs() {
  const context = useContext(BinConfigsContext);
  if (!context) {
    throw new Error("useBinConfigs must be used within a BinConfigsProvider");
  }
  return context;
}
