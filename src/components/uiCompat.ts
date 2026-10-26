import React from "react";
import { ButtonGroup } from "azure-devops-ui/Components/ButtonGroup/ButtonGroup";
import { Card } from "azure-devops-ui/Components/Card/Card";
import { Dialog } from "azure-devops-ui/Components/Dialog/Dialog";
import { Dropdown } from "azure-devops-ui/Components/Dropdown/Dropdown";
import { IDropdownProps } from "azure-devops-ui/Components/Dropdown/Dropdown.Props";
import { FormItem } from "azure-devops-ui/Components/FormItem/FormItem";
import { Header } from "azure-devops-ui/Components/Header/Header";
import { MessageCard } from "azure-devops-ui/Components/MessageCard/MessageCard";
import { Page } from "azure-devops-ui/Components/Page/Page";
import { ProgressBar } from "azure-devops-ui/Components/ProgressBar/ProgressBar";
import { Status } from "azure-devops-ui/Components/Status/Status";
import { SimpleTableCell, Table, TwoLineTableCell } from "azure-devops-ui/Components/Table/Table";
import { ITableColumn, ITableProps } from "azure-devops-ui/Components/Table/Table.Props";
import { MenuButton } from "azure-devops-ui/Menu";
import { ITooltipProps, Tooltip } from "azure-devops-ui/TooltipEx";
import { Tab, Tabs } from "azure-devops-ui/Tabs";

/**
 * azure-devops-ui components are typed against the React version they declare as a peer dependency
 * (React 16), whose `JSX.Element` does not satisfy this project's React 19 element type. Their props are
 * still correct, so casting to a component type with the same props restores renderability without
 * losing prop checking.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asComponent<C extends React.ComponentType<any>>(
  component: C,
): React.ComponentType<React.ComponentProps<C>> {
  return component as unknown as React.ComponentType<React.ComponentProps<C>>;
}

export const ButtonGroupBase = asComponent(ButtonGroup);
export const CardBase = asComponent(Card);
export const DialogBase = asComponent(Dialog);
export const FormItemBase = asComponent(FormItem);
export const HeaderBase = asComponent(Header);
export const MenuButtonBase = asComponent(MenuButton);
export const MessageCardBase = asComponent(MessageCard);
export const PageBase = asComponent(Page);
export const ProgressBarBase = asComponent(ProgressBar);
export const StatusBase = asComponent(Status);
export const TabBase = asComponent(Tab);
export const TabsBase = asComponent(Tabs);
export const TooltipBase = Tooltip as unknown as React.ComponentType<ITooltipProps>;

// Generic classes need a generic function-component cast so the row type stays checked.
export const TableBase = Table as unknown as <T>(props: ITableProps<T>) => React.ReactElement;
export const DropdownBase = Dropdown as unknown as <T>(props: IDropdownProps<T>) => React.ReactElement;

interface ICellProps<T> {
  ariaRowIndex?: number;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  columnIndex: number;
  tableColumn?: ITableColumn<T>;
}

interface ITwoLineCellProps<T> {
  ariaRowIndex?: number;
  columnIndex: number;
  line1: React.ReactNode;
  line2: React.ReactNode;
  tableCellClassName?: string;
  tableColumn?: ITableColumn<T>;
}

// A column's renderCell must return a table cell: Table places the result directly inside the row's <tr>.
export const SimpleCell = SimpleTableCell as unknown as <T>(props: ICellProps<T>) => React.ReactElement;
export const TwoLineCell = TwoLineTableCell as unknown as <T>(props: ITwoLineCellProps<T>) => React.ReactElement;
