import { memo } from "react";
import { useI18n } from "./I18nContext";
import { SearchIcon } from "./icons";

interface QuickFilterProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export const QuickFilter = memo(function QuickFilter({
  value,
  onChange,
  placeholder,
}: QuickFilterProps) {
  const { t } = useI18n();
  return (
    <div className="quick-filter-wrap">
      <SearchIcon size={16} />
      <input
        type="text"
        className="quick-filter-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("common").search}
      />
      {value && (
        <button className="quick-filter-clear" onClick={() => onChange("")}>
          ×
        </button>
      )}
    </div>
  );
});
