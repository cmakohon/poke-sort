import type {
  BinCondition,
  BinConfig,
  BinRuleGroup,
  BinSet,
  FieldMeta,
} from "@poke-sort/shared";

export interface BinConfigsContextValue {
  configs: BinConfig[];
  sets: BinSet[];
  fieldDefinitions: FieldMeta[];
  /** Which catalog facet-backed pickers should read their options from. */
  gameKey?: string;
  lang: string;
  isPending: boolean;
  isActivating: boolean;
  isPresetMutating: boolean;
  hasCatchAll: boolean;
  /** The bin low-confidence scans are diverted to, if one is dedicated. */
  reviewBinNumber?: number;
  selectedBin: number;
  selectedSet?: BinSet;
  setSelectedBin: (bin: number) => void;
  selectedConfig: BinConfig;
  save: (
    binNumber: number,
    rules: BinRuleGroup,
    isCatchAll?: boolean,
    isReviewBin?: boolean,
  ) => void;
  clear: (binNumber: number) => void;
  activateSet: (guid: string) => Promise<void>;
  createSet: (name: string) => Promise<void>;
  saveSet: (name: string) => Promise<void>;
  renameSet: (guid: string, name: string) => Promise<void>;
  deleteSet: (guid: string) => Promise<void>;
}

export interface BinCardProps {
  config: BinConfig;
  active?: boolean;
  onClick: () => void;
}

export interface ConditionRowProps {
  condition: BinCondition;
  onChange: (updated: BinCondition) => void;
  onRemove: () => void;
}

export interface PresetSelectorProps {
  readOnly?: boolean;
}

export interface RuleGroupEditorProps {
  group: BinRuleGroup;
  onChange: (updated: BinRuleGroup) => void;
  onRemove?: () => void;
  depth?: number;
}
