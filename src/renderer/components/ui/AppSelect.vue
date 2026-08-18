<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import chevronDownIcon from "../../assets/icons/chevron-down.svg";

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{
  options: AppSelectOption[];
  placeholder?: string;
  title?: string;
  ariaLabel: string;
  disabled?: boolean;
}>();

const model = defineModel<string>({ required: true });
const rootElement = ref<HTMLElement | null>(null);
const triggerElement = ref<HTMLButtonElement | null>(null);
const listboxElement = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const activeIndex = ref(-1);
const selectId = useId();
const listboxId = `${selectId}-listbox`;

const renderedOptions = computed<AppSelectOption[]>(() => {
  if (!props.placeholder) {
    return props.options;
  }

  return [{ value: "", label: props.placeholder }, ...props.options];
});

const selectedOption = computed(() =>
  renderedOptions.value.find((option) => option.value === model.value),
);
const displayLabel = computed(
  () => selectedOption.value?.label ?? props.placeholder ?? "请选择",
);
const isPlaceholder = computed(
  () => !selectedOption.value || (model.value === "" && Boolean(props.placeholder)),
);
const activeOptionId = computed(() =>
  isOpen.value && activeIndex.value >= 0
    ? `${selectId}-option-${activeIndex.value}`
    : undefined,
);

function findEnabledIndex(startIndex: number, direction: 1 | -1): number {
  const options = renderedOptions.value;
  if (options.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (startIndex + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
  }

  return -1;
}

function resolveInitialIndex(): number {
  const selectedIndex = renderedOptions.value.findIndex(
    (option) => option.value === model.value && !option.disabled,
  );
  if (selectedIndex >= 0) {
    return selectedIndex;
  }

  return renderedOptions.value.findIndex((option) => !option.disabled);
}

function scrollActiveOptionIntoView(): void {
  void nextTick(() => {
    const option = listboxElement.value?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex.value}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  });
}

function openMenu(): void {
  if (props.disabled || isOpen.value) {
    return;
  }

  activeIndex.value = resolveInitialIndex();
  isOpen.value = true;
  scrollActiveOptionIntoView();
}

function closeMenu(restoreFocus = false): void {
  if (!isOpen.value) {
    return;
  }

  isOpen.value = false;
  activeIndex.value = -1;
  if (restoreFocus) {
    void nextTick(() => triggerElement.value?.focus());
  }
}

function toggleMenu(): void {
  if (isOpen.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

function moveActiveOption(direction: 1 | -1): void {
  const startIndex = activeIndex.value >= 0 ? activeIndex.value : resolveInitialIndex();
  activeIndex.value = findEnabledIndex(startIndex, direction);
  scrollActiveOptionIntoView();
}

function moveToBoundary(position: "first" | "last"): void {
  const options = renderedOptions.value;
  const indexes = options.map((_, index) => index);
  const searchIndexes = position === "first" ? indexes : indexes.reverse();
  activeIndex.value =
    searchIndexes.find((index) => !options[index]?.disabled) ?? -1;
  scrollActiveOptionIntoView();
}

function selectOption(option: AppSelectOption): void {
  if (option.disabled) {
    return;
  }

  model.value = option.value;
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (!isOpen.value) {
        openMenu();
      } else {
        moveActiveOption(1);
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (!isOpen.value) {
        openMenu();
      } else {
        moveActiveOption(-1);
      }
      break;
    case "Home":
    case "End":
      if (!isOpen.value) {
        return;
      }
      event.preventDefault();
      moveToBoundary(event.key === "Home" ? "first" : "last");
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      if (!isOpen.value) {
        openMenu();
        return;
      }
      if (activeIndex.value >= 0) {
        const option = renderedOptions.value[activeIndex.value];
        if (option) {
          selectOption(option);
        }
      }
      break;
    case "Escape":
      if (!isOpen.value) {
        return;
      }
      event.preventDefault();
      closeMenu(true);
      break;
    case "Tab":
      closeMenu();
      break;
    default:
      break;
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && !rootElement.value?.contains(target)) {
    closeMenu();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      closeMenu();
    }
  },
);

watch(
  () => props.options,
  () => {
    if (isOpen.value) {
      activeIndex.value = resolveInitialIndex();
      scrollActiveOptionIntoView();
    }
  },
  { deep: true },
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
  <div
    ref="rootElement"
    :class="['app-select', { open: isOpen, disabled }]">
    <button
      ref="triggerElement"
      type="button"
      class="app-select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      :title="title"
      :disabled="disabled"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown">
      <span :class="['app-select-value', { placeholder: isPlaceholder }]">
        {{ displayLabel }}
      </span>
      <img
        class="app-select-chevron"
        :class="{ rotated: isOpen }"
        :src="chevronDownIcon"
        alt="" />
    </button>

    <Transition name="app-select-menu">
      <div
        v-if="isOpen"
        :id="listboxId"
        ref="listboxElement"
        class="app-select-listbox"
        role="listbox"
        :aria-label="ariaLabel">
        <button
          v-for="(option, index) in renderedOptions"
          :id="`${selectId}-option-${index}`"
          :key="`${option.value}-${index}`"
          type="button"
          role="option"
          tabindex="-1"
          :data-option-index="index"
          :class="[
            'app-select-option',
            {
              active: activeIndex === index,
              selected: option.value === model,
            },
          ]"
          :aria-selected="option.value === model"
          :disabled="option.disabled"
          @mouseenter="!option.disabled && (activeIndex = index)"
          @mousedown.prevent
          @click="selectOption(option)">
          <span>{{ option.label }}</span>
          <span
            class="app-select-option-check"
            :class="{ visible: option.value === model }"
            aria-hidden="true">✓</span
          >
        </button>
      </div>
    </Transition>
  </div>
</template>
