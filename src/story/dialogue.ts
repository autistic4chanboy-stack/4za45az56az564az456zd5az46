/** Structure des dialogues scénarisés. */
export interface DialogueOption {
  text: string;
  /** Nœud suivant (ou null pour fermer). */
  next?: string | null;
  action?: () => void;
  cond?: () => boolean;
  /** Style visuel : option importante, risquée… */
  tone?: 'normal' | 'quete' | 'danger';
}

export interface DialogueNode {
  text: string | (() => string);
  options: DialogueOption[];
}

export type DialogueTree = Record<string, DialogueNode>;
