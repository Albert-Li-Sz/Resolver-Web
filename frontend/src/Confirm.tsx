import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal, type Run } from "./ui";
export type Confirmation = {
  title: string;
  details: string[];
  checkbox?: string;
  confirm?: string;
};
const ConfirmationContext = createContext<
  (value: Confirmation) => Promise<boolean>
>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<Confirmation | null>(null);
  const [checked, setChecked] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPrompt(null);
  };
  const ask = (value: Confirmation) =>
    new Promise<boolean>((resolve) => {
      if (resolver.current) {
        resolve(false);
        return;
      }
      resolver.current = resolve;
      setChecked(false);
      setPrompt(value);
    });
  return (
    <ConfirmationContext.Provider value={ask}>
      {children}
      {prompt ? (
        <Modal title={prompt.title} close={() => close(false)}>
          <div className="confirmation-impact">
            {prompt.details.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {prompt.checkbox ? (
            <label className="check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              {prompt.checkbox}
            </label>
          ) : null}
          <div className="row">
            <button
              className="secondary"
              autoFocus
              onClick={() => close(false)}
            >
              取消
            </button>
            <button
              className="danger"
              disabled={!!prompt.checkbox && !checked}
              onClick={() => close(true)}
            >
              {prompt.confirm || "确认操作"}
            </button>
          </div>
        </Modal>
      ) : null}
    </ConfirmationContext.Provider>
  );
}
export function useProtectedAction(run: Run) {
  const ask = useContext(ConfirmationContext);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const execute = async (
    prompt: Confirmation | null,
    fn: () => Promise<unknown>,
    success?: string,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      if (prompt && !(await ask(prompt))) return;
      await run(fn, success);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { execute, pending };
}
