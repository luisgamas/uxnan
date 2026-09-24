<script lang="ts">
  // The single mounted "close over unfinished work?" prompt, driven by the
  // `closeGuard` store (the window's close path asks it). Dismissing it any
  // way but the confirm button keeps the app open.
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { i18n } from "$lib/i18n";
  import { closeGuard } from "$lib/state/closeGuard.svelte";

  const description = $derived.by(() => {
    const { working, unsaved } = closeGuard.work;
    const parts = [
      ...(working > 0 ? [i18n.plural(working, "closeGuard.workingOne", "closeGuard.workingOther")] : []),
      ...(unsaved > 0 ? [i18n.plural(unsaved, "closeGuard.unsavedOne", "closeGuard.unsavedOther")] : []),
    ];
    return `${parts.join(" · ")}. ${i18n.t("closeGuard.consequence")}`;
  });
</script>

<ConfirmDialog
  open={closeGuard.open}
  danger
  title={i18n.t("closeGuard.title")}
  {description}
  confirmLabel={i18n.t("closeGuard.confirm")}
  onconfirm={() => closeGuard.choose(true)}
  ondismiss={() => closeGuard.choose(false)}
/>
