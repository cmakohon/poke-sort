import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBinConfigs } from "@/features/bins/api/use-bin-configs";
import { RuleGroupEditor } from "@/features/bins/components/rule-group-editor";
import {
  binConfigSchema,
  type BinConfigFormValues,
} from "@/schemas/sort-bins.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { BinRuleGroup } from "@poke-sort/shared";
import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";

function emptyRuleGroup(): BinRuleGroup {
  return { id: crypto.randomUUID(), combinator: "and", conditions: [] };
}

export function BinConfigPanel() {
  const { t } = useTranslation("bins");
  const {
    selectedConfig: config,
    save,
    clear,
    configs,
    reviewBinNumber,
    isPending,
  } = useBinConfigs();

  const form = useForm<BinConfigFormValues>({
    resolver: zodResolver(binConfigSchema) as Resolver<BinConfigFormValues>,
    defaultValues: {
      isCatchAll: false,
      isReviewBin: false,
      rules: emptyRuleGroup(),
    },
  });

  useEffect(() => {
    form.reset({
      isCatchAll: config.isCatchAll ?? false,
      isReviewBin: config.isReviewBin ?? false,
      rules:
        config.rules.conditions.length > 0 ? config.rules : emptyRuleGroup(),
    });
  }, [config, form]);

  const isOnlyCatchAll =
    config.isCatchAll &&
    configs.filter((c) => c.isCatchAll && c.binNumber !== config.binNumber)
      .length === 0;

  const handleSave = useCallback(
    (values: BinConfigFormValues) => {
      if (!values.isCatchAll && isOnlyCatchAll) {
        form.setError("isCatchAll", {
          message: t("binConfigPanel.needCatchAllError"),
        });
        return;
      }
      save(
        config.binNumber,
        values.rules as BinRuleGroup,
        values.isCatchAll,
        values.isReviewBin,
      );
    },
    [config, save, isOnlyCatchAll, form, t],
  );

  const handleClear = useCallback(() => {
    if (isOnlyCatchAll) {
      form.setError("isCatchAll", {
        message: t("binConfigPanel.needCatchAllError"),
      });
      return;
    }
    form.reset({
      isCatchAll: false,
      isReviewBin: false,
      rules: emptyRuleGroup(),
    });
    clear(config.binNumber);
  }, [config, clear, form, isOnlyCatchAll, t]);

  const isCatchAll = form.watch("isCatchAll");
  // Which bin holds review while this panel is open, ignoring this bin — the
  // hint is about where review cards are going *instead* of here.
  const otherReviewBin =
    reviewBinNumber != null && reviewBinNumber !== config.binNumber
      ? reviewBinNumber
      : undefined;

  return (
    <div className="flex flex-col">
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mb-4">
        <h2 className="font-semibold font-heading">
          {t("binConfigPanel.binHeading", { number: config.binNumber })}
        </h2>
        <Controller
          name="isCatchAll"
          control={form.control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={field.value ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  const next = !field.value;
                  field.onChange(next);
                  // The catch-all already receives review-tier scans when no
                  // bin is dedicated to them, so holding both roles is a
                  // contradiction with no meaning — drop the review role
                  // rather than save a flag the panel then hides.
                  if (next) form.setValue("isReviewBin", false);
                }}
              >
                {field.value
                  ? t("binConfigPanel.catchAllEnabled")
                  : t("binConfigPanel.setCatchAll")}
              </Button>
              {field.value && (
                <p className="text-xs text-muted-foreground">
                  {t("binConfigPanel.catchAllDescription")}
                </p>
              )}
            </div>
          )}
        />
        {!isCatchAll && (
          <Controller
            name="isReviewBin"
            control={form.control}
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={field.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => field.onChange(!field.value)}
                >
                  {field.value
                    ? t("binConfigPanel.reviewBinEnabled")
                    : t("binConfigPanel.setReviewBin")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {field.value
                    ? t("binConfigPanel.reviewBinDescription")
                    : otherReviewBin != null
                      ? t("binConfigPanel.reviewBinElsewhere", {
                          number: otherReviewBin,
                        })
                      : t("binConfigPanel.reviewBinHint")}
                </p>
              </div>
            )}
          />
        )}
      </div>
      {!isCatchAll && (
        <ScrollArea>
          <Label className="mb-2">{t("binConfigPanel.rulesLabel")}</Label>
          <Controller
            name="rules"
            control={form.control}
            render={({ field }) => (
              <RuleGroupEditor
                group={field.value as BinRuleGroup}
                onChange={field.onChange}
              />
            )}
          />
        </ScrollArea>
      )}
      {form.formState.errors.isCatchAll && (
        <FieldError errors={[form.formState.errors.isCatchAll]} />
      )}
      {form.formState.errors.rules && (
        <FieldError errors={[form.formState.errors.rules]} />
      )}
      <div className="flex gap-2 mt-2 justify-end">
        <Button
          type="button"
          variant="destructive"
          onClick={handleClear}
          disabled={isPending}
        >
          {t("binConfigPanel.clear")}
        </Button>
        <Button
          type="button"
          onClick={form.handleSubmit(handleSave)}
          disabled={isPending}
        >
          {isPending && <IconLoader2 className="size-4 animate-spin" />}
          {t("binConfigPanel.save")}
        </Button>
      </div>
    </div>
  );
}
