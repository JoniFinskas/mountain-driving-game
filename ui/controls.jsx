import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import * as Select from '@radix-ui/react-select';

function Dropdown({host,id,label,value,items,onChange,disabled}){
  const [open,setOpen]=useState(false);
  const container=host.closest('dialog')||document.querySelector('#game');
  return <Select.Root value={value} onValueChange={onChange} open={open} onOpenChange={setOpen} disabled={disabled}>
    <Select.Trigger id={id} className="select-trigger" aria-label={label}>
      <Select.Value/><Select.Icon asChild><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12} data-game-dropdown="true"
        onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();setOpen(false);}}>
        <Select.ScrollUpButton className="select-scroll" aria-label="Scroll up">⌃</Select.ScrollUpButton>
        <Select.Viewport className="select-viewport">
          {items.map(item=><Select.Item key={item.value} value={item.value} disabled={item.disabled} className="select-item">
            <div><Select.ItemText>{item.label}</Select.ItemText>{item.description&&<span className="select-description">{item.description}</span>}</div>
            <Select.ItemIndicator className="select-check" aria-hidden="true">✓</Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="select-scroll" aria-label="Scroll down">⌄</Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

export function createDropdown(host,options){
  const root=createRoot(host);let settings={...options};
  const render=()=>flushSync(()=>root.render(<Dropdown host={host} {...settings} onChange={value=>{settings.value=value;render();options.onChange(value);}}/>));
  render();
  return {setValue(value){settings.value=String(value);render();},setDisabled(disabled){settings.disabled=disabled;render();},destroy(){root.unmount();}};
}
