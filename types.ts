
export type SchoolLevel = 'Tiểu học' | 'THCS';

export interface LessonActivity {
  id: string;
  name: string;
  objective: string;
  content: string;
  product: string;
  execution: string;
}

export interface DigitalCompetency {
  id: string;
  code: string;
  label: string;
  description: string;
  level: SchoolLevel;
  checked: boolean;
}

export interface LessonPlan {
  title: string;
  subject: string;
  grade: string;
  level: SchoolLevel;
  duration: string;
  learningOutcomes: string;
  digitalCompetencies: DigitalCompetency[];
  resources: string;
  activities: LessonActivity[];
}
