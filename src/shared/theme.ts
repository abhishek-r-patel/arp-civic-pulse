/* Non-sensitive browser appearance preferences and pre-paint normalization; never ballot storage. */
export const APPEARANCE_STORAGE_KEY = "civic-pulse-theme";
export const APPEARANCE_MODES = ["light", "dark", "system"] as const;

export const APPEARANCE_BOOTSTRAP = `(()=>{let preference="system";try{const stored=localStorage.getItem("${APPEARANCE_STORAGE_KEY}");if(["light","dark","system"].includes(stored)){preference=stored;}else if(stored!==null){localStorage.removeItem("${APPEARANCE_STORAGE_KEY}");}}catch{}const resolved=preference==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):preference;document.documentElement.setAttribute("data-theme",resolved);document.documentElement.style.colorScheme=resolved;})();`;
