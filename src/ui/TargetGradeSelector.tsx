import {
  GRADE_BODY,
  GRADE_VOICE,
  type PetGrade,
  type TargetMode,
} from '../domain/petFilters';
import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../domain/petIcons';

const TARGET_GRADE_ORDER: PetGrade[] = ['大婉', '大粗', '小婉', '小粗'];

export interface TargetGradeSelectorProps {
  mode: TargetMode;
  selectedGrades: readonly PetGrade[];
  onSelect: (grade: PetGrade) => void;
  label: string;
  testIdPrefix: string;
}

export function TargetGradeSelector({
  mode,
  selectedGrades,
  onSelect,
  label,
  testIdPrefix,
}: TargetGradeSelectorProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-4 gap-1"
      data-testid={`${testIdPrefix}-combinations`}
    >
      {TARGET_GRADE_ORDER.map((grade) => {
        const body = GRADE_BODY[grade];
        const voice = GRADE_VOICE[grade];
        const voiceTarget =
          mode === 'perfect' ? (voice === '婉转声' ? '+100' : '-100') : voice;
        const bodyIcon = bodyMedalIconByLabel(body);
        const voiceIcon = voiceMedalIconByLabel(voiceTarget);
        if (!bodyIcon || !voiceIcon) {
          throw new Error(`Missing medal icon for target ${grade}`);
        }
        const selected = selectedGrades.includes(grade);

        return (
          <button
            key={grade}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(grade)}
            data-testid={`${testIdPrefix}-grade-${grade}`}
            className={`flex min-h-[72px] flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-[10px] leading-tight ${
              selected
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            <span className="flex items-center gap-0.5">
              <img src={bodyIcon} alt="" title={body} className="h-5 w-5 object-contain" />
              <img
                src={voiceIcon}
                alt=""
                title={mode === 'perfect' ? `${voice} ${voiceTarget}` : voice}
                className="h-5 w-5 object-contain"
              />
            </span>
            <span className="mt-1 flex flex-col">
              <span>{body}</span>
              <span>{voice}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
