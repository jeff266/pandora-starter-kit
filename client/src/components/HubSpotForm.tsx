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
  #hs-form-target .hs-form-field {
    margin-bottom: 16px;
  }
  #hs-form-target label.hs-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #8888a8;
    margin-bottom: 6px;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif;
  }
  #hs-form-target .hs-input {
    width: 100% !important;
    box-sizing: border-box;
    background: #0f0f1e !important;
    border: 1px solid #1a1a35 !important;
    color: #eeeef5 !important;
    border-radius: 10px !important;
    padding: 13px 16px !important;
    font-size: 15px !important;
    font-family: 'DM Sans', 'Outfit', system-ui, sans-serif !important;
    transition: border-color 0.2s, box-shadow 0.2s !important;
    appearance: none;
    -webkit-appearance: none;
    outline: none !important;
  }
  #hs-form-target select.hs-input {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238888a8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") !important;
    background-repeat: no-repeat !important;
    background-position: right 14px center !important;
    padding-right: 36px !important;
    cursor: pointer !important;
  }
  #hs-form-target select.hs-input option {
    background: #0f0f1e;
    color: #eeeef5;
  }
  #hs-form-target .hs-input:focus {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
  }
  #hs-form-target input.hs-input::placeholder {
    color: #55557a !important;
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
  #hs-form-target .hs-richtext {
    color: #55557a;
    font-size: 12px;
    margin-bottom: 8px;
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
  }
  #hs-form-target .hs_recaptcha {
    margin-top: 8px;
  }
  #hs-form-target .actions {
    margin-top: 8px;
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

    const existingScript = document.querySelector(
      'script[src*="hsforms.net"]'
    ) as HTMLScriptElement | null;

    const mount = () => {
      window.hbspt?.forms.create({
        portalId: "24202132",
        formId: "17c2a07c-ae14-4f99-801f-1b516f2ba761",
        region: "na1",
        target: "#hs-form-target",
      });
    };

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
