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
  #hs-form-target .hs-form {
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif;
    text-align: left;
  }
  #hs-form-target .hs-form-field,
  #hs-form-target li.hs-form-field,
  #hs-form-target .field.hs-form-field {
    margin-bottom: 16px !important;
  }
  #hs-form-target fieldset {
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
  }
  #hs-form-target ul {
    list-style: none !important;
    padding: 0 !important;
    margin: 0 !important;
  }
  #hs-form-target label.hs-label,
  #hs-form-target .hs-form label {
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    color: #4b5563 !important;
    display: block !important;
    margin-bottom: 6px !important;
  }
  #hs-form-target input.hs-input,
  #hs-form-target textarea.hs-input,
  #hs-form-target select.hs-input {
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
    font-size: 15px !important;
    width: 100% !important;
    box-sizing: border-box !important;
    border-radius: 8px !important;
    border: 1px solid #e5e7eb !important;
    padding: 11px 14px !important;
    color: #111827 !important;
    background: #fff !important;
    outline: none !important;
    transition: border-color 0.2s, box-shadow 0.2s !important;
  }
  #hs-form-target input.hs-input:focus,
  #hs-form-target textarea.hs-input:focus,
  #hs-form-target select.hs-input:focus {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.12) !important;
  }
  #hs-form-target .hs-button.primary {
    width: 100%;
    background: linear-gradient(135deg, #6366f1, #a78bfa) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 10px !important;
    padding: 13px 28px !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
    cursor: pointer !important;
    letter-spacing: -0.01em !important;
    transition: opacity 0.2s, box-shadow 0.2s !important;
    box-shadow: 0 4px 20px rgba(99,102,241,0.3) !important;
    margin-top: 8px;
  }
  #hs-form-target .hs-button.primary:hover {
    opacity: 0.88 !important;
    box-shadow: 0 6px 28px rgba(99,102,241,0.4) !important;
  }
  #hs-form-target .hs-error-msgs {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
  }
  #hs-form-target .hs-error-msg {
    color: #dc2626 !important;
    font-size: 12px !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
  }
  #hs-form-target .submitted-message {
    color: #059669 !important;
    font-size: 16px !important;
    font-weight: 600 !important;
    text-align: center;
    padding: 24px 0;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
  }
  #hs-form-target .hs-form-required {
    color: #6366f1 !important;
  }
  #hs-form-target .hs_recaptcha { margin-top: 8px; }
  #hs-form-target .actions { margin-top: 8px; }
  #hs-form-target input[type="checkbox"],
  #hs-form-target input[type="radio"] {
    accent-color: #6366f1;
  }
  #hs-form-target .hs-richtext,
  #hs-form-target .hs-richtext p,
  #hs-form-target .legal-consent-container,
  #hs-form-target .legal-consent-container p,
  #hs-form-target .legal-consent-container label,
  #hs-form-target .hs-form-checkbox label {
    color: #9ca3af !important;
    font-size: 12px !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
  }
`;

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

    const mount = () => {
      window.hbspt?.forms.create({
        portalId: "24202132",
        formId: "17c2a07c-ae14-4f99-801f-1b516f2ba761",
        region: "na1",
        target: "#hs-form-target",
      });
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
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
  }, []);

  return <div id="hs-form-target" />;
}
