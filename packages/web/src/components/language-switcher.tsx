import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/lib/i18n";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language as SupportedLanguage;

  return (
    <Select
      value={current}
      onValueChange={(lang) => void i18n.changeLanguage(lang!)}
    >
      <SelectTrigger id="language-switcher" className="w-40">
        <SelectValue>{LANGUAGE_NATIVE_NAMES[current] ?? current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {LANGUAGE_NATIVE_NAMES[lang]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
