import { useEffect, useRef } from "react";

declare global {
  interface Window {
    hbspt?: {
      forms: {
        create: (opts: {
          portalId: string;
          formId: string;
          region: string;
          target: string;
        }) => void;
      };
    };
  }
}

const STYLE_ID = "hs-pandora-theme";

const CSS = `
  @keyframes autofill-dark {
    0%, 100% {
      background-color: #0f0f1e;
      color: #eeeef5;
    }
  }

  #hs-form-target .hs-form {
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif;
    text-align: left;
  }
  #hs-form-target .hs-form-field,
  #hs-form-target li.hs-form-field,
  #hs-form-target .field.hs-form-field {
    margin-bottom: 16px !important;
    background: transparent !important;
  }
  #hs-form-target .hs-input:focus {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
    outline: none !important;
  }
  #hs-form-target input.hs-input:-webkit-autofill,
  #hs-form-target input.hs-input:-webkit-autofill:hover,
  #hs-form-target input.hs-input:-webkit-autofill:focus,
  #hs-form-target input.hs-input:autofill {
    -webkit-text-fill-color: #eeeef5 !important;
    caret-color: #eeeef5 !important;
    -webkit-box-shadow: 0 0 0 1000px #0f0f1e inset !important;
    box-shadow: 0 0 0 1000px #0f0f1e inset !important;
    animation: autofill-dark 1s forwards !important;
    animation-duration: 5000s !important;
  }
  #hs-form-target .hs-button.primary {
    width: 100%;
    background: linear-gradient(135deg, #6366f1, #a78bfa) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 10px !important;
    padding: 14px 28px !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
    cursor: pointer !important;
    transition: opacity 0.2s, box-shadow 0.2s !important;
    box-shadow: 0 4px 24px rgba(99,102,241,0.25) !important;
    margin-top: 8px;
    letter-spacing: -0.01em;
  }
  #hs-form-target .hs-button.primary:hover {
    opacity: 0.88 !important;
    box-shadow: 0 6px 32px rgba(99,102,241,0.4) !important;
  }
  #hs-form-target .hs-error-msgs {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
  }
  #hs-form-target .hs-error-msg {
    color: #f87171 !important;
    font-size: 12px !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
  }
  #hs-form-target .submitted-message {
    color: #34d399 !important;
    font-size: 16px !important;
    font-weight: 600 !important;
    text-align: center;
    padding: 24px 0;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
  }
  #hs-form-target .hs-form-required {
    color: #a78bfa !important;
  }
  #hs-form-target fieldset {
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
    background: transparent !important;
  }
  #hs-form-target ul {
    list-style: none !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
  }
  #hs-form-target .hs_recaptcha { margin-top: 8px; }
  #hs-form-target .actions { margin-top: 8px; }
  #hs-form-target input[type="checkbox"],
  #hs-form-target input[type="radio"] {
    accent-color: #6366f1;
  }
  #hs-form-target select.hs-input {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238888a8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") !important;
    background-repeat: no-repeat !important;
    background-position: right 14px center !important;
    padding-right: 36px !important;
    cursor: pointer !important;
  }
`;

function applyDarkStyles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(
    "label.hs-label, .hs-form label"
  ).forEach(el => {
    el.style.setProperty("color", "#8888a8", "important");
    el.style.setProperty("font-size", "13px", "important");
    el.style.setProperty("font-weight", "500", "important");
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("margin-bottom", "6px", "important");
    el.style.setProperty("font-family", "'DM Sans', 'Outfit', system-ui, sans-serif", "important");
  });

  root.querySelectorAll<HTMLElement>(
    "input.hs-input, textarea.hs-input"
  ).forEach(el => {
    el.style.setProperty("background-color", "#0f0f1e", "important");
    el.style.setProperty("background", "#0f0f1e", "important");
    el.style.setProperty("border", "1px solid #1a1a35", "important");
    el.style.setProperty("color", "#eeeef5", "important");
    el.style.setProperty("border-radius", "10px", "important");
    el.style.setProperty("padding", "13px 16px", "important");
    el.style.setProperty("font-size", "15px", "important");
    el.style.setProperty("font-family", "'DM Sans', 'Outfit', system-ui, sans-serif", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("color-scheme", "dark", "important");
    el.style.setProperty("outline", "none", "important");
    el.style.setProperty("-webkit-appearance", "none", "important");
  });

  root.querySelectorAll<HTMLSelectElement>("select.hs-input").forEach(el => {
    el.style.setProperty("background-color", "#0f0f1e", "important");
    el.style.setProperty("border", "1px solid #1a1a35", "important");
    el.style.setProperty("color", "#eeeef5", "important");
    el.style.setProperty("border-radius", "10px", "important");
    el.style.setProperty("padding", "13px 36px 13px 16px", "important");
    el.style.setProperty("font-size", "15px", "important");
    el.style.setProperty("font-family", "'DM Sans', 'Outfit', system-ui, sans-serif", "important");
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("color-scheme", "dark", "important");
    el.style.setProperty("-webkit-appearance", "none", "important");
    el.style.setProperty("appearance", "none", "important");
    el.querySelectorAll("option").forEach(opt => {
      opt.style.setProperty("background-color", "#0f0f1e", "important");
      opt.style.setProperty("color", "#eeeef5", "important");
    });
  });

  root.querySelectorAll<HTMLElement>(
    "li.hs-form-field, .field.hs-form-field, div.hs-input"
  ).forEach(el => {
    el.style.setProperty("background", "transparent", "important");
    el.style.setProperty("background-color", "transparent", "important");
  });

  root.querySelectorAll<HTMLElement>(
    ".hs-richtext, .hs-richtext p, .hs-richtext span, .hs-richtext div, .hs-richtext a," +
    ".legal-consent-container, .legal-consent-container p, .legal-consent-container span," +
    ".legal-consent-container label, .legal-consent-container a," +
    ".hs-form-checkbox label, .hs-checkbox-display"
  ).forEach(el => {
    el.style.setProperty("color", "#55557a", "important");
    el.style.setProperty("font-size", "12px", "important");
  });
}

export default function HubSpotForm() {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const target = document.getElementById("hs-form-target");

    const observer = new MutationObserver(() => {
      if (target) applyDarkStyles(target);
    });

    if (target) {
      observer.observe(target, { childList: true, subtree: true, attributes: false });
    }

    const mount = () => {
      window.hbspt?.forms.create({
        portalId: "24202132",
        formId: "17c2a07c-ae14-4f99-801f-1b516f2ba761",
        region: "na1",
        target: "#hs-form-target",
      });

      let elapsed = 0;
      const pollId = setInterval(() => {
        if (target) applyDarkStyles(target);
        elapsed += 300;
        if (elapsed >= 5000) clearInterval(pollId);
      }, 300);
    };

    const existingScript = document.querySelector(
      'script[src*="hsforms.net"]'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      if (window.hbspt) {
        mount();
      } else {
        existingScript.addEventListener("load", mount);
      }
    } else {
      const script = document.createElement("script");
      script.src = "//js.hsforms.net/forms/embed/v2.js";
      script.charset = "utf-8";
      script.async = true;
      script.onload = mount;
      document.body.appendChild(script);
    }

    return () => {
      observer.disconnect();
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
  }, []);

  return <div id="hs-form-target" />;
}
