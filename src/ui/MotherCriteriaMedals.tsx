import {
  GRADE_BODY,
  GRADE_VOICE,
  type PetGrade,
  type TargetMode,
} from '../domain/petFilters';
import {
  effectiveMotherVoices,
  type MotherCriteria,
  type MotherVoice,
} from '../domain/motherCriteria';
import { getMotherCriteria, setMotherCriteria, useMotherCriteria } from './motherCriteriaStore';
import { SegmentedControl } from './primitives/SegmentedControl';
import { setTargetMode, useTargetMode } from './targetModeStore';
import { TargetGradeSelector } from './TargetGradeSelector';

const GRADES: PetGrade[] = ['大婉', '大粗', '小婉', '小粗'];

/** 默认档位：与种公 / 看板一致，只勾「大婉」（大块头 + 婉转声）。 */
const DEFAULT_GRADE: PetGrade = '大婉';

export interface MotherCriteriaMedalsProps {
  testIdPrefix: string;
}

/** 母本按体型 + 声音组合选择达标奖牌，**强制单选**：点一个换一个，不累加、也不会清空。 */
export function MotherCriteriaMedals({ testIdPrefix }: MotherCriteriaMedalsProps) {
  const mode = useTargetMode();
  const criteria = useMotherCriteria();
  const selectedGrades = selectedGradesFor(criteria, mode);

  const saveGrades = (current: MotherCriteria, grades: PetGrade[], targetMode: TargetMode) => {
    const bodies = [...new Set(grades.map((grade) => GRADE_BODY[grade]))];
    const voices = [
      ...new Set(
        grades.map((grade) => voiceOptionFor(GRADE_VOICE[grade], targetMode)),
      ),
    ];
    setMotherCriteria({ ...current, bodies, voices, grades });
  };

  const changeMode = (value: string) => {
    const nextMode = value as TargetMode;
    if (nextMode === mode) return;
    const current = getMotherCriteria();
    saveGrades(current, selectedGradesFor(current, mode), nextMode);
    setTargetMode(nextMode);
  };

  const selectGrade = (grade: PetGrade) => {
    const current = getMotherCriteria();
    const selected = selectedGradesFor(current, mode);
    if (selected.length === 1 && selected[0] === grade) return; // 已经是它：保持选中，不清空
    saveGrades(current, [grade], mode);
  };

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-medals`}>
      <SegmentedControl
        label="母本达标模式"
        value={mode}
        options={[
          { value: 'perfect', label: '追满分' },
          { value: 'medal', label: '追双牌' },
        ]}
        onValueChange={changeMode}
        optionTestId={(value) => `${testIdPrefix}-mode-${value}`}
      />
      <TargetGradeSelector
        mode={mode}
        selectedGrades={selectedGrades}
        onSelect={selectGrade}
        label="母本达标奖牌组合"
        testIdPrefix={testIdPrefix}
      />
    </div>
  );
}

/** 当前选中的档位：永远只返回一个（强制单选），旧数据里的多选值只取第一个。 */
function selectedGradesFor(criteria: MotherCriteria, mode: TargetMode): PetGrade[] {
  if (criteria.grades !== undefined) {
    return [criteria.grades[0] ?? DEFAULT_GRADE];
  }

  const voices = effectiveMotherVoices(criteria.voices, mode);
  const matched = GRADES.filter((grade) => {
    const bodySelected =
      criteria.bodies.length === 0 || criteria.bodies.includes(GRADE_BODY[grade]);
    const voice = voiceOptionFor(GRADE_VOICE[grade], mode);
    const voiceSelected = voices.length === 0 || voices.includes(voice);
    return bodySelected && voiceSelected;
  });
  return [matched[0] ?? DEFAULT_GRADE];
}

function voiceOptionFor(
  voice: (typeof GRADE_VOICE)[PetGrade],
  mode: TargetMode,
): MotherVoice {
  if (mode === 'medal') return voice;
  return voice === '婉转声' ? '+100' : '-100';
}
