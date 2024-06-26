import { EditableComponent } from "./editableComponent.js";
import { Action } from "./models/action.js";
import { Component } from "./models/component.js";
import { CustomEventType } from "./models/customEventType.js";
import { ActiveStateEnum, AdvSearchVM, CellSelected, MQEvent, OperatorEnum, OrderBy, OrderbyDirection, Where } from "./models/enum.js";
import { Paginator } from "./paginator.js";
import { Utils } from "./utils/utils.js";
import { ObservableList } from './models/observableList.js';
import { Section } from './section.js';
import { ListViewSection } from "./listViewSection.js";
import { Html } from "./utils/html.js";
import { ContextMenu } from "./contextMenu.js";
import { FeaturePolicy } from "./models/featurePolicy.js";
import { Str } from "./utils/ext.js";
import { Client } from "./clients/client.js";
import { Spinner } from "./spinner.js";
import { PatchVM } from "./models/patch.js";
import { SqlViewModel } from "./models/sqlViewModel.js";
import { ListViewSearch } from "./listViewSearch.js";
import { ListViewItem } from "./listViewItem.js";
import { Toast } from "./toast.js";
import EventType from "./models/eventType.js";
import { Uuid7 } from "./structs/uuidv7.js";
import { ConfirmDialog } from "./confirmDialog.js";
import ObservableArgs from "./models/observable.js";
import { ElementType } from "./models/elementType.js";
import { ComponentExt } from "./utils/componentExt.js";
import { EntityRef } from "./models/entityRef.js";

/**
 * Represents a list view component that allows editable features and other interactions like sorting and pagination.
 * @typedef {import('./searchEntry.js').SearchEntry} SearchEntry
 * @typedef {import('./tabEditor.js').TabEditor} TabEditor
 * @typedef {import('./gridView.js').GridView} GridView
 */
export class ListView extends EditableComponent {
    IsListView = true;
    SelectedIds = [];
    /** @type {ListViewSection} */
    MainSection;
    /**
     * @type {OrderBy[]}
     */
    OrderBy = [];
    /**
     * @type {any[]}
     */
    CacheData = [];
    /**
     * @type {any[]}
     */
    RefData = [];
    DataLoaded = new Action();
    DblClick = new Action();
    RowClick = new Action();
    VirtualScroll = false;
    /** @type {string} */
    FocusId;
    get Editable() { return this.Meta.CanAdd; }
    /**
     * Constructs an instance of ListView with the specified UI component.
     * @param {Component} ui The UI component associated with this list view.
     * @param {HTMLElement} [ele] Optional HTML element.
     */
    constructor(ui, ele = null) {
        super(ui, ele);
        this.DeleteTempIds = [];
        this.Meta = ui;
        this.Id = ui.Id;
        this.Name = ui.FieldName;
        /** @type {Component[]} */
        this.Header = [];
        this.RowData = new ObservableList();
        /** @type {AdvSearchVM} */
        // @ts-ignore
        this.AdvSearchVM = {
            ActiveState: ActiveStateEnum.Yes,
            // @ts-ignore
            OrderBy: localStorage.getItem('OrderBy' + this.Meta.Id) ?? []
        };
        this._hasLoadRef = false;
        if (ele !== null) {
            this.Resolve(ui, ele);
        }

        this._rowHeight = this.Meta.BodyItemHeight ?? 26;
        this._theadTable = this.Meta.HeaderHeight ?? 40;
        this._tfooterTable = this.Meta.FooterHeight ?? 35;
        this._scrollTable = this.Meta.ScrollHeight ?? 10;
        window.addEventListener(this.QueueName, this.RealtimeUpdateListViewItem.bind(this));
        this._preQueryFn = Utils.IsFunction(this.Meta.PreQuery);
        /** @type {ListViewItem} */
        this.LastShiftViewItem = undefined;
        /** @type {number} */
        this.LastIndex = undefined;
        this.EntityFocusId = "";
        /** @type {HTMLElement} */
        this.LastElementFocus = null;
        this.LastComponentFocus = null;
    }

    /**
     * Handles real-time updates of list view items.
     * @param {MQEvent} mqEvent The message queue event.
     */
    RealtimeUpdateListViewItem(mqEvent) {
        let updatedData = mqEvent.Message;
        let listViewItem = this.MainSection.FilterChildren(x => x.EntityId === updatedData[this.IdField]).FirstOrDefault();
        if (listViewItem === null) return;
        this.CacheData.FirstOrDefault(x => x[this.IdField] === updatedData[this.IdField]).CopyPropFrom(updatedData);
        listViewItem.Entity.CopyPropFrom(updatedData);
        let arr = listViewItem.FilterChildren(x => !x.Dirty || x.GetValueText() != null).Select(x => x.Name).ToArray();
        listViewItem.UpdateView(false, arr);
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterWebsocket, updatedData, listViewItem).Done();
    }

    /**
     * Resolves additional configurations or setup for the component.
     * @param {Component} com The component to configure.
     * @param {HTMLElement} [ele] Optional HTML element to use in the resolution.
     */
    Resolve(com, ele = null) {
        let txtArea = document.createElement('textarea');
        txtArea.innerHTML = ele.innerHTML;
        com.FormatEntity = txtArea.value;
        ele.innerHTML = null;
    }

    /** @type {FeaturePolicy[]} */
    GridPolicies = [];
    /** @type {FeaturePolicy[]} */
    GeneralPolicies = [];
    /**
     * Renders the list view, setting up necessary configurations and data bindings.
     */
    Render() {
        if (this.EditForm) {
            this.GridPolicies = this.EditForm.GetElementPolicies(this.Meta.Id) ?? [];
            this.GeneralPolicies = this.EditForm.Policies;
        }
        this.CanWrite = this.CanDo(x => x.CanWrite || x.CanWriteAll);
        Html.Take(this.ParentElement).DataAttr('name', this.Name);
        this.AddSections();
        this.SetRowDataIfExists();
        this.EditForm?.ResizeListView();
        if (this.Meta.LocalRender) this.LocalRender();
        else this.LoadAllData();
    }

    /**
     * Renders the list view either by re-rendering or using locally stored data based on the configuration.
     */
    LocalRender() {
        // Setting the header from the local metadata configuration
        this.Header = this.Header ?? this.Meta.LocalHeader;

        if (this.Meta.LocalRender) {
            // If local rendering is enabled, re-render the view
            this.Rerender();
        } else {
            // If local rendering is not enabled, use the local data directly
            this.RowData.Data = this.Meta.LocalData;
        }
    }

    Rerender() {
        this.DisposeNoRecord();
        this.MainSection.DisposeChildren();
        Html.Take(this.MainSection.Element).Clear();
        this.RenderContent();
    }

    /**
     * Evaluates if any policy within the general or grid-specific policies meets the provided condition.
     * @param {(item: FeaturePolicy) => boolean} predicate A function to test each element for a condition.
     * @returns {boolean} True if any policy meets the condition, otherwise false.
     */
    CanDo(predicate) {
        return this.GeneralPolicies?.some(predicate) || this.GridPolicies?.some(predicate);
    }

    /**
     * Reloads data for the list view, potentially using cached headers and considering pagination settings.
     * @param {boolean} [cacheHeader=false] Specifies whether headers should be cached.
     * @param {number} [skip=null] Specifies the number of items to skip (for pagination).
     * @param {number} [pageSize=null] Specifies the size of the page to load.
     * @returns {Promise<any[]>} A promise that resolves to the list of reloaded data objects.
     */
    async ReloadData(cacheHeader = false, skip = null, pageSize = null) {
        if (this.Meta.LocalQuery && Array.isArray(this.Meta.LocalQuery)) {
            this.Meta.LocalData = this.Meta.LocalQuery;
            this.Meta.LocalRender = true;
        }
        if (this.Meta.LocalQuery && !Array.isArray(this.Meta.LocalQuery)) {
            this.Meta.LocalData = this.Meta.LocalData ?? typeof this.Meta.LocalQuery === Str.Type
                ? JSON.parse(this.Meta.LocalQuery.toString())
                : this.Meta.LocalQuery;
            this.Meta.LocalRender = true;
        }
        if (this.Meta.LocalRender && this.Meta.LocalData != null) {
            this.SetRowData(this.Meta.LocalData);
            return this.Meta.LocalData;
        }
        if (this.Paginator != null) {
            this.Paginator.Options.PageSize = this.Paginator.Options.PageSize === 0 ? (this.Meta.Row ?? 12) : this.Paginator.Options.PageSize;
        }
        pageSize = (pageSize ?? this.Paginator?.Options?.PageSize ?? this.Meta.Row) ?? 20;
        skip = skip ? (this.Paginator?.Options?.PageIndex * pageSize) : 0;
        let sql = this.GetSql(skip, pageSize, cacheHeader);
        return await this.CustomQuery(sql);
    }

    CalcFilterQuery() {
        return this.ListViewSearch.CalcFilterQuery();
    }
    /** @type {Where[]} */
    Wheres = [];
    /**
     * Gets the SQL for data retrieval based on the current state of the list view.
     * @param {number} [skip=null] Number of records to skip for pagination.
     * @param {number} [pageSize=null] Page size for pagination.
     * @param {boolean} [cacheMeta=false] Whether to cache meta information.
     * @param {boolean} [count=true] Whether to include a count of total records.
     * @returns {SqlViewModel} The SQL view model with query details.
     */
    GetSql(skip = null, pageSize = null, cacheMeta = false, count = true) {
        let submitEntity = Utils.IsFunction(this.Meta.PreQuery, true, this);
        let orderBy = this.AdvSearchVM.OrderBy.Any() ? this.AdvSearchVM.OrderBy.Combine(x => {
            let sortDirection = x.OrderbyDirectionId === OrderbyDirection.ASC ? "asc" : "desc";
            return `ds.${x.FieldName} ${sortDirection}`;
        }) : null;
        let basicCondition = this.CalcFilterQuery();
        let fnBtnCondition = this.Wheres.Combine(x => `(${x.Condition})`, " and ");
        let finalCon = [basicCondition, fnBtnCondition].filter(x => x).Combine(null, " and ");
        /** @type {SqlViewModel} */
        // @ts-ignore
        const res = {
            ComId: this.Meta.Id,
            Params: submitEntity,
            OrderBy: orderBy || (!this.Meta.OrderBy ? "ds.Id asc" : this.Meta.OrderBy),
            Where: finalCon,
            Count: count,
            Skip: skip,
            Top: pageSize,
            SkipXQuery: cacheMeta,
            MetaConn: this.MetaConn,
            DataConn: this.DataConn,
        };
        return res;
    }

    ShouldSetEntity = true;
    /**
     * 
     * @param {any[]} listData 
     */
    SetRowData(listData) {
        this.RowData?.Clear();
        const hasElement = listData.length; // Assuming hasElement is a method defined in this class
        if (hasElement) {
            this.RowData._data.push(...listData);
        }
        this.RenderContent(); // Assuming renderContent is a method defined in this class

        if (this.Entity !== null && this.ShouldSetEntity) { // Assuming shouldSetEntity is a property
            this.Entity[this.Name] = this.RowData.Data; // Assuming setComplexPropValue is a method
        }
    }

    /**
     * Executes a custom SQL query using the provided SQL view model.
     * @param {SqlViewModel} vm The view model containing SQL query details.
     * @returns {Promise<any[]>} A promise that resolves to the list of data objects retrieved.
     */
    async CustomQuery(vm) {
        try {
            const data = await Client.Instance.SubmitAsync({
                NoQueue: true,
                Url: `/api/feature/com?t=${Client.Token.TenantCode || Client.Tenant}`,
                Method: "POST",
                JsonData: JSON.stringify(vm, this.getCircularReplacer(), 2),
                AllowAnonymous: true,
                ErrorHandler: (xhr) => {
                    if (xhr.status === 400) {
                        Client.Token = null;
                        Toast.Warning("Phiên truy cập đã hết hạn! Vui lòng chờ trong giây lát, hệ thống đang tải lại trang");
                    }
                },
            });
            let total = data.count?.total ?? 0;
            let rows = data.value;
            if (!rows || !rows.length) {
                this.SetRowData(null);
                return null;
            }
            Spinner.Hide();
            await this.LoadMasterData(rows);
            this.SetRowData(rows);
            this.UpdatePagination(total, rows.length);
            Utils.IsFunction(this.Meta.FormatEntity)?.call(null, rows, this);
            this.DataLoaded?.invoke(ds);
            return rows;
        } catch (error) {
            console.error('Error during custom query:', error);
            throw error;
        }
    }

    getCircularReplacer() {
        const seen = new WeakSet();
        return (key, value) => {
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) {
                    return;
                }
                seen.add(value);
            }
            return value;
        };
    }

    async LoadMasterData(rows = null, spinner = true) {
        var headers = this.Header.filter(x => !Utils.isNullOrWhiteSpace(x.RefName));
        if (headers.length == 0) {
            return;
        }
        rows = rows || this.RowData.Data;
        this.SyncMasterData(rows, headers);
        let dataSource = headers.map(x => this.FormatDataSourceByEntity(x, headers, rows)).filter(x => x !== null);
        if (dataSource.Nothing()) {
            return;
        }

        let dataTasks = dataSource
            .filter(x => x.DataSourceOptimized).map(x => ({
                Header: x,
                Data: Client.Instance.GetByIdAsync(x.RefName, x.DataSourceOptimized)
            }));

        let results = await Promise.all(dataTasks.map(x => x.Data));
        dataTasks.forEach((task, index) => {
            task.Data = results[index];
            this.setRemoteSource(task.Data.data, task.Header.RefName, task.Header);
        });
        this.SyncMasterData(rows, headers);
    }

    setRemoteSource(remoteData, typeName, header) {
        let localSource = this.RefData[typeName];
        if (!localSource) {
            this.RefData[typeName] = remoteData;
        } else {
            remoteData.forEach(item => {
                if (!localSource.some(localItem => localItem[this.IdField] === item[this.IdField])) {
                    localSource.push(item);
                }
            });
        }

        if (header) {
            header.LocalData = remoteData;
        }
    }

    SyncMasterData(rows = null, headers = null) {
        rows = rows || this.RowData.Data;
        headers = headers || this.Header;

        headers.filter(x => x.RefName).forEach(header => {
            if (!header.FieldName || header.FieldName.length <= 2) {
                return;
            }

            let containId = header.FieldName.substr(header.FieldName.length - 2) === this.IdField;
            if (!containId) {
                return;
            }

            rows.forEach(row => {
                let objField = header.FieldName.substr(0, header.FieldName.length - 2);
                let propType = header.RefName;
                if (!propType) {
                    return;
                }

                let propVal = row[objField];
                let found = this.RefData[propType]?.find(source => source[this.IdField] === row[header.FieldName]);

                if (found) {
                    row[objField] = found;
                } else if (propVal && !found) {
                    this.RefData[propType] = this.RefData[propType] || [];
                    this.RefData[propType].push(propVal);
                }
            });
        });
    }

    FormatDataSourceByEntity(currentHeader, allHeaders, entities) {
        let entityIds = allHeaders
            .filter(x => x.RefName === currentHeader.RefName)
            .flatMap(x => this.getEntityIds(x, entities))
            .filter((v, i, a) => a.indexOf(v) === i);

        if (entityIds.length === 0) {
            return null;
        }

        currentHeader.DataSourceOptimized = entityIds.sort();
        return currentHeader;
    }

    getEntityIds(header, entities) {
        if (!entities || entities.length === 0) {
            return [];
        }

        let ids = [];
        entities.forEach(x => {
            let id = x[header.FieldName];
            if (!id) {
                return;
            } else if (id.includes(',')) {
                ids.push(...id.split(',').map(y => y));
            } else {
                ids.push(id);
            }
        });
        return ids;
    }

    /**
     * Updates pagination details based on total data and current page count.
     * @param {number} total The total number of records.
     * @param {number} currentPageCount The number of records in the current page.
     */
    UpdatePagination(total, currentPageCount) {
        if (!this.Paginator) {
            return;
        }
        let options = this.Paginator.Options;
        options.Total = total;
        options.CurrentPageCount = currentPageCount;
        options.PageNumber = options.PageIndex + 1;
        options.StartIndex = options.PageIndex * options.PageSize + 1;
        options.EndIndex = options.StartIndex + options.CurrentPageCount - 1;
        this.Paginator.UpdateView();
    }

    /**
     * Adds sections to the ListView based on the component configurations.
     */
    AddSections() {
        if (this.Meta.LiteGrid) {
            this.Element = this.ParentElement;
            this.Element.innerHTML = null;
            this.MainSection = new ListViewSection(null, this.ParentElement);
            this.AddChild(this.MainSection);
            return;
        }
        Html.Take(this.ParentElement).Div.ClassName("grid-wrapper");
        this.Element = Html.Context;
        if (this.Meta.CanSearch) {
            Html.Instance.Div.ClassName("grid-toolbar search").End.Render();
        }
        this.ListViewSearch = new ListViewSearch(this.Meta);
        this.AddChild(this.ListViewSearch);
        Html.Take(this.Element).Div.ClassName("list-content").End.Div.ClassName("empty");
        this.EmptySection = new ListViewSection(null, Html.Context);
        this.EmptySection.ParentElement = this.Element;
        this.AddChild(this.EmptySection);

        // @ts-ignore
        this.MainSection = new ListViewSection(null, this.EmptySection.Element.previousElementSibling);
        this.AddChild(this.MainSection);

        Html.Instance.EndOf(".list-content");
        this.RenderPaginator();
    }

    /** @type {any[]} */
    FormattedRowData;
    /**
     * Renders the content within the main section of the ListView.
     */
    RenderContent() {
        this.MainSection.DisposeChildren();
        this.EmptySection?.DisposeChildren();
        this.FormattedRowData = this.FormattedRowData.Nothing() ? this.RowData.Data : this.FormattedRowData;
        if (this.FormattedRowData.Nothing()) {
            return;
        }

        this.FormattedRowData.SelectForEach((rowData, index) => {
            let rowSection = this.RenderRowData(this.Header, rowData, this.MainSection);
        });
        this.ContentRendered();
    }

    /**
     * Renders the data for each row within the list view.
     * @param {Component[]} headers The headers to use in the row.
     * @param {object} row The data object for the row.
     * @param {ListViewSection} section The section where the row is to be added.
     * @param {number} [index=null] Optional index for the row.
     * @param {boolean} [emptyRow=false] Indicates if the row is empty.
     * @returns {ListViewItem} The ListViewItem created for the row.
     */
    RenderRowData(headers, row, section, index = null, emptyRow = false) {
        let rowSection = this.Meta.LiteGrid ? new ListViewItem() : new ListViewItem('div');
        rowSection.EmptyRow = emptyRow;
        rowSection.Entity = row;
        rowSection.ParentElement = section.Element;
        rowSection.ListView = this;
        rowSection.ListViewSection = section instanceof ListViewSection ? section : null;
        rowSection.Meta = this.Meta;
        rowSection.EditForm = this.EditForm;
        section.AddChild(rowSection, index);
        rowSection.RenderRowData(headers, row, index, emptyRow);
        return rowSection;
    }

    /**
     * Clears all row data from the ListView.
     */
    ClearRowData() {
        this.RowData.Clear();
        this.RowAction(x => x.Dispose(), x => !x.EmptyRow);
        this.MainSection.Element.innerHTML = null;
        if (this.Entity == null || this.Parent.IsSearchEntry) {
            return;
        }
        if (this.ShouldSetEntity) {
            this.Entity[this.Name] = this.RowData.Data;
        }
    }

    /** @type {ListViewItem[]} */
    // @ts-ignore
    get AllListViewItem() { return this.MainSection.Children; }
    /**
     * Performs an action on all items that meet the condition specified by predicate.
     * @param {(item: EditableComponent) => void} action - The action to perform on each ListViewItem that meets the condition.
     * @param {(item: EditableComponent) => boolean} predicate - The condition to check each ListViewItem.
     */
    RowAction(action, predicate = null) {
        this.AllListViewItem.filter(x => !predicate || predicate(x)).forEach(action);
    }

    /**
     * Sets row data if the entity exists and it is not an empty string.
     */
    SetRowDataIfExists() {
        const value = Utils.GetPropValue(this.Entity, this.Name);
        if (this.Entity != null && Array.isArray(value)) {
            this.RowData._data = value;
        }
    }

    /**
     * Method to update the view of the ListView, possibly forcing the update and setting the dirty flag.
     * @param {boolean} [force=false] Whether to force the update.
     * @param {boolean|null} [dirty=null] Optional dirty flag to set.
     * @param {string[]} componentNames Component names to specifically update.
     */
    UpdateView(force = false, dirty = null, componentNames = []) {
        if (!this.Editable) {
            if (force) {
                this.ListViewSearch.RefreshListView();
            }
        } else {
            this.RowAction(row => row.UpdateView(force, dirty, componentNames), row => !row.EmptyRow);
        }
    }

    /**
     * Adds a new empty row to the ListView.
     */
    AddNewEmptyRow() {
        if (this.Meta.LiteGrid || this.Disabled || !this.Editable || (this.EmptySection?.Children.HasElement() === true)) {
            return;
        }
        let emptyRowData = {};
        let fn = Utils.IsFunction(this.Meta.DefaultVal);
        if (!this.Meta.DefaultVal && fn) {
            let dfObj = fn.call(this, this);
            Object.keys(dfObj).forEach(key => {
                emptyRowData[key] = dfObj[key];
            });
        }
        emptyRowData[this.IdField] = null;
        let rowSection = this.RenderRowData(this.Header, emptyRowData, this.EmptySection, null, true);
        Object.entries(emptyRowData).forEach(([field, value]) => {
            // @ts-ignore
            rowSection.PatchModel.push({
                Field: field,
                Value: value?.toString()
            });
        });
        if (!this.Meta.TopEmpty) {
            this.MainSection.Element.insertBefore(this.MainSection.Element, this.EmptySection.Element);
        } else {
            this.MainSection.Element.appendChild(this.EmptySection.Element.firstElementChild);
        }
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterEmptyRowCreated, emptyRowData).Done();
    }

    /**
     * Renders the paginator component if necessary based on the configuration and data.
     */
    RenderPaginator() {
        if (this.Meta.LocalRender || this.Meta.LiteGrid) {
            if (this.Paginator) {
                this.Paginator.Show = false;
            }
            return;
        }
        if (!this.Meta.Row || this.Meta.Row === 0) {
            this.Meta.Row = 20;
        }

        if (!this.Paginator) {
            // @ts-ignore
            this.Paginator = new Paginator({
                Total: 0,
                PageSize: this.Meta.Row ?? 50,
                CurrentPageCount: this.RowData.Data.length,
            });
            this.AddChild(this.Paginator);
        }
    }

    get UpdatedRows() {
        return this.AllListViewItem.OrderBy(x => x.RowNo).Where(x => x.Dirty).Select(x => x.Entity).Distinct();
    };

    get UpdatedListItems() {
        return this.AllListViewItem.OrderBy(x => x.RowNo).Where(x => x.Dirty);
    };

    /**
     * Retrieves a list of patches if there are updates, optionally updating the view.
     * @param {boolean} [updateView=false] - Indicates whether the view should be updated.
     * @returns {PatchVM[] | null} An array of PatchVM instances or null if no updates are dirty.
     */
    GetPatches(updateView = false) {
        if (!this.Dirty) {
            return null;
        }

        if (this.Meta.IdField !== null && this.Meta.IdField !== this.IdField) {
            this.UpdatedRows.forEach(row => {
                row[this.Meta.IdField] = this.EntityId;
            });
        }

        const res = [];
        this.UpdatedListItems.forEach(item => {
            res.push(item.GetPatchEntity());
        });

        if (updateView) {
            this.UpdateView();
        }

        return res;
    }

    /**
     * Filters and sorts the header components based on their properties.
     * @param {Component[]} components The list of components to filter.
     * @returns {Component[]} The filtered and sorted list of header components.
     */
    FilterColumns(components) {
        if (components.length === 0) return components;

        let SpecificComponent = components.some(x => x.ComponentId === this.Meta.Id);
        if (SpecificComponent) {
            components = components.filter(x => x.ComponentId === this.Meta.Id);
        } else {
            components = components.filter(x => x.ComponentId === null);
        }

        let Permission = this.EditForm.GetGridPolicies(
            components.map(x => x.Id),
            Utils.ComponentId
        );

        let Headers = components
            .filter(header => !header.IsPrivate || Permission
                .filter(x => x.RecordId === header.Id)
                .every(policy => policy.CanRead)
            )
            .sort((a, b) => {
                if (a.Frozen !== b.Frozen) return a.Frozen - b.Frozen;
                return a.Order - b.Order;
            });

        this.OrderHeaderGroup(Headers);

        this.Header.length = 0; // Clear the array
        this.Header.push(...Headers); // Add all headers

        this.Header = this.Header.filter(x => x !== null);
        return this.Header;
    }

    /**
     * Applies a filter to the ListView, reloading data based on the current filter settings.
     * @returns {Promise} A promise that resolves once the data has been reloaded with the applied filter.
     */
    ApplyFilter() {
        this.ClearRowData();
        return this.ReloadData(true, 0);
    }

    GetSelectedRows() {
        if (this.LastListViewItem?.GroupRow === true) {
            return [this.LastListViewItem.Entity];
        } else {
            return this.MainSection.Children.filter(x => x.IsListViewItem && x.Selected).map(x => x.Entity);
        }
    }

    BodyContextMenuShow = new Action();
    /**
     * Handles the context menu for the body of the list view, showing additional options.
     * @param {Event} e The event object associated with the context menu action.
     */
    BodyContextMenuHandler(e) {
        e.preventDefault();
        e.stopPropagation();
        ContextMenu.Instance.MenuItems.Clear();
        this.BodyContextMenuShow?.invoke();
        if (this.Disabled) {
            return;
        }
        this.SetSelected(e);
        let ctxMenu = ContextMenu.Instance;
        this.RenderCopyPasteMenu(this.CanWrite);
        this.RenderEditMenu(this.CanWrite);
        ctxMenu.Top = e.Top();
        ctxMenu.Left = e.Left();
        ctxMenu.Render();
        document.body.appendChild(ctxMenu.Element);
        ctxMenu.Element.style.position = "absolute";
    }

    async RenderRelatedDataMenu() {
        const targetRef = await Client.Instance.GetByIdAsync('EntityRef', this.DataConn, [this.Meta.Id]);
        if (targetRef.Nothing()) {
            return;
        }
        const menuItems = targetRef.Select(x => ({
            Text: x.MenuText,
            Click: (arg) => this.OpenFeature(x),
        })).ToList();
        // @ts-ignore
        ContextMenu.Instance.MenuItems.push({
            Icon: "fal fal fa-ellipsis-h",
            Text: "Dữ liệu liên quan",
            MenuItems: menuItems
        });
    }

    /**
     * 
     * @param {EntityRef} meta 
     * @returns 
     */
    async OpenFeature(meta) {
        const tabEditorMd = await import('./tabEditor.js');
        const searchEntryMd = await import('./searchEntry.js');
        const tabs = tabEditorMd.TabEditor.Tabs;
        let tab = tabs.find(tab => tab.Name === meta.ViewClass);
        if (tab) {
            tab.Focus();
            this.Filter(tab, meta);
            this.HasLoadRef = true;
            return;
        }
        this.HasLoadRef = false;
        const feature = await ComponentExt.LoadFeature(meta.ViewClass);
        const Id = feature.Name + feature.Id;
        tab = new tabEditorMd.TabEditor(feature.EntityName);
        tab.Name = feature.Name;
        tab.Id = Id;
        tab.Icon = feature.Icon;
        tab.Meta = tab.Meta = feature;
        tab.Render();
        tab.DOMContentLoaded.add(() => {
            const grdiView = tab.FilterChildren(x => x instanceof searchEntryMd.SearchEntry)
                .find(X => X.Meta.Id === meta.TargetComId);
            grdiView.DOMContentLoaded.add(() => {
                if (this.HasLoadRef) {
                    return;
                }
                this.Filter(tab, meta);
                this.HasLoadRef = true;
            });
        });
    }

    // /** @type {EditableComponent[]} */
    /** @type {CellSelected[]} */
    CellSelected = [];
    /**
     * Applies filtering logic to the ListView based on the EntityRef.
     * It finds a specific GridView based on EntityRef, clears its conditions and dates,
     * and then updates it with new selected conditions.
     *
     * @param {TabEditor} tab - The TabEditor instance.
     * @param {EntityRef} entityRef - The EntityRef containing filtering criteria.
     */
    Filter(tab, entityRef) {
        /** @type {GridView} */
        // @ts-ignore
        let gridView1 = tab.FilterChildren(x => x instanceof EditableComponent.GridViewMd.GridView).find(X => X.Meta.Id === entityRef.TargetComId);
        if (!gridView1) {
            return;
        }

        gridView1.CellSelected = [];
        gridView1.AdvSearchVM.Conditions = [];
        gridView1.ListViewSearch.EntityVM.StartDate = null;
        gridView1.ListViewSearch.EntityVM.EndDate = null;

        this.GetRealTimeSelectedRows().then(Selecteds => {
            let Com = gridView1.Header.find(X => X.FieldName === entityRef.TargetFieldName);
            if (!Com) return;

            let CellSelecteds = Selecteds.map(Selected => ({
                FieldName: entityRef.TargetFieldName,
                FieldText: Com.Label,
                ComponentType: Com.ComponentType,
                Value: Selected[entityRef.FieldName].toString(),
                ValueText: Selected[entityRef.FieldName].toString(),
                Operator: OperatorEnum.In,  // Assuming OperatorEnum is predefined
                OperatorText: "Contains",
                Logic: 'Or',
                IsSearch: true,
                Group: true
            }));

            gridView1.CellSelected.push(...CellSelecteds);
            gridView1.ActionFilter();
        });
    }

    /**
     * Sets the row as selected based on the event target.
     * @param {Event} e The event object.
     */
    SetSelected(e) {
        // @ts-ignore
        let target = e.target.closest('tr');
        /** @type {ListViewItem} */
        // @ts-ignore
        let currentRow = this.MainSection.Children.find(x => x.Element === target);
        if (currentRow) {
            if (!currentRow.GroupRow || this.Meta.GroupReferenceId) {
                if (this.SelectedIds.length === 1) {
                    this.ClearSelected();
                }
                currentRow.Selected = true;
                this.LastListViewItem = currentRow;
                this.SelectedIndex = currentRow.RowNo;
            }
        }
    }

    /**
     * Renders the pagination details and handles the data loading process.
     */
    LoadAllData() {
        this.LoadHeader().then(() => {
            this.ReloadData(true).then(() => {
                this.RenderContent();
            });
        });
    }

    Dropdown = "Dropdown";

    async LoadHeader() {
        var columns = this.LoadGridPolicy();
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.UpdateHeader, columns);
        columns = this.FilterColumns(columns);
        this.Header = columns;
    }

    LoadGridPolicy() {
        var sysSetting = [];
        if (this.Meta.Columns.length > 0) {
            sysSetting = this.Meta.Columns;
        }
        else {
            if (!Utils.isNullOrWhiteSpace(this.Meta.Template)) {
                sysSetting = JSON.parse(this.Meta.Template, null, 2);
            }
            else {
                sysSetting = this.EditForm.Meta.GridPolicies.filter(x => x.EntityId == this.Meta.FieldName);
            }
        }
        return sysSetting;
    }
    NotCellText = ["Button", "Image", "ImageUploader"]
    /**
     * Filters the columns based on the header configuration and applies sort order.
     */
    OrderHeaderGroup(headers) {
        for (let i = 0; i < headers.length; i++) {
            var gridPolicies = this.EditForm.GetDefaultGridPolicies();
            var gridPolicies1 = gridPolicies.filter(x => x.EntityId == "GridPolicyId" && x.RecordId == headers[i].Id);
            headers[i].CanWrite = ((headers[i].Editable || this.NotCellText.includes(headers[i].ComponentType))
                && (this.EditForm.Meta.IsPublic || (gridPolicies.some(x => x.CanWrite)
                    && gridPolicies1.some(x => x.CanWrite)) || (gridPolicies.some(x => x.CanWrite)
                        && gridPolicies1.length == 0))) || headers[i].ComponentType == "Button";
            for (let j = i + 1; j < headers.length; j++) {
                if (headers[i].GroupName && headers[i].GroupName === headers[j].GroupName && headers[i + 1].GroupName !== headers[j].GroupName) {
                    let temp = headers[i + 1];
                    headers[i + 1] = headers[j];
                    headers[j] = temp;
                }
            }
        }
    }

    /** @type {any[]} */
    _copiedRows;

    /**
    * Copies the selected rows.
    * @param {object} ev The event object.
    */
    CopySelected(ev) {
        this._originRows = this.GetSelectedRows();
        const txt = JSON.stringify(this._originRows);
        this._copiedRows = JSON.parse(txt);
        window.navigator.clipboard.writeText(txt);
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterCopied, this._originRows, this._copiedRows);
    }

    /**
    * Pastes the copied rows.
    * @param {object} ev The event object.
    */
    async PasteSelected(ev) {
        var clipBoard = await window.navigator.clipboard.readText();
        if (!clipBoard && this._copiedRows.Nothing()) {
            this._copiedRows = JSON.parse(clipBoard);
        }
        if (this._copiedRows.Nothing()) {
            return;
        }

        Toast.Success("Copying...");
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforePasted, this._originRows, this._copiedRows).Done(() => {
            var index = this.AllListViewItem.IndexOf(x => x.Selected);
            this.AddRowsNo(this._copiedRows, index).Done(list => {
                super.Focus();
                if (this.Meta.IsRealtime) {
                    Promise.all(list.Select(x => x.PatchUpdateOrCreate())).Done(() => {
                        Toast.Success("Data pasted successfully !");
                        super.Dirty = false;
                        this.ClearSelected();
                    });
                }
                else {
                    Toast.Success("Data pasted successfully !");
                }
                this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterPasted, this._originRows, this._copiedRows).Done();
            });
        });
    }

    /**
     * Renders menus related to the data linked with the selected rows, such as copy, paste, and editing options.
     * @param {boolean} canWrite Indicates whether the user has write permissions.
     */
    RenderCopyPasteMenu(canWrite) {
        if (canWrite) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-copy",
                Text: "Copy",
                Click: () => this.CopySelected()
            });
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-clone",
                Text: "Copy & Paste",
                Click: () => this.DuplicateSelected(null, false)
            });
        }
        if (canWrite && this._copiedRows && this._copiedRows.length > 0) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-paste",
                Text: "Paste",
                Click: () => this.PasteSelected()
            });
        }
    }

    /**
     * Renders edit menu options based on user permissions.
     * @param {boolean} canWrite Indicates whether the user has write permissions.
     */
    RenderEditMenu(canWrite) {
        if (canWrite) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-history",
                Text: "View History",
                Click: async () => await this.ViewHistory()
            });
        }
        if (this.CanDo(x => x.CanDeactivate || x.CanDeactivateAll)) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-unlink",
                Text: "Deactivate",
                Click: () => this.DeactivateSelected()
            });
        }
        if (this.CanDo(x => x.CanDelete || x.CanDeleteAll)) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "fal fa-trash",
                Text: "Delete Data",
                Click: () => this.HardDeleteSelected()
            });
        }
    }

    /**
     * Renders the view history popup for the selected row.
     * @param {object} currentItem The currently selected row item.
     */
    async ViewHistory(currentItem) {
        const selectedRows = this.GetSelectedRows();
        currentItem = selectedRows.LastOrDefault();
        Html.Take(this.EditForm.Element).Div.ClassName("backdrop")
            .Style("align-items: center;").Escape((e) => this.Dispose());
        this._history = Html.Context;
        Html.Instance.Div.ClassName("popup-content confirm-dialog").Style("top: 0;")
            .Div.ClassName("popup-title").InnerHTML("Xem lịch sử")
            .Div.ClassName("icon-box").Span.ClassName("fal fa-times")
            .Event(EventType.Click, () => this._history.remove())
            .EndOf(".popup-title")
            .Div.ClassName("popup-body scroll-content");
        const body = Html.Context;
        const com = new Component();
        com.Id = Uuid7.Id25();
        com.FieldName = 'Conditions';
        com.Column = 4;
        com.RefName = 'History';
        const md = await import('./gridView.js');
        const _filterGrid = new md.GridView(com);
        _filterGrid.Meta.LocalHeader = [
            // @ts-ignore
            {
                Id: 1 .toString(),
                FieldName: 'InsertedBy',
                Label: "User create",
                RefName: 'User',
                FormatData: "FullName",
                Active: true,
                ComponentType: 'SearchEntry',
                MaxWidth: "100px",
                MinWidth: "100px",
            },
            // @ts-ignore
            {
                Id: '2',
                FieldName: 'InsertedDate',
                Label: "Created date",
                Active: true,
                FormatData: "{0:dd/MM/yyyy HH:mm}",
                ComponentType: "Datepicker",
                TextAlign: "left",
                MaxWidth: "150px",
                MinWidth: "150px",
            },
            // @ts-ignore
            {
                Id: '4',
                FieldName: 'TextHistory',
                Label: "Dữ liệu thay đổi",
                Active: true,
                ComponentType: "Label",
                MaxWidth: "700px",
                MinWidth: "700px",
            }
        ];
        _filterGrid.ParentElement = body;
        this.TabEditor.AddChild(_filterGrid);
    }

    /** @type {FeaturePolicy[]} */
    RecordPolicy = [];
    static IsOwner = '__IsOwner';
    /**
     * Renders sharing menu options based on user permissions and selected rows.
     * @param {Array<object>} selectedRows Array of selected rows.
     * @returns {Promise} A promise that resolves once the sharing menu is rendered.
     */
    async RenderShareMenu(selectedRows) {
        const PermissionLoaded = "PermissionLoaded";
        if (selectedRows.length === 0) return;
        const noPolicyRows = selectedRows.filter(x => !x[PermissionLoaded]);
        const noPolicyRowIds = noPolicyRows.map(x => x[this.IdField].toString());
        const rowPolicy = await this.LoadRecordPolicy(this.Meta.RefName, noPolicyRowIds);
        rowPolicy.forEach(policy => this.RecordPolicy.push(policy));
        noPolicyRows.forEach(row => row[PermissionLoaded] = true);
        const canShare = this.CanDo(x => x.CanShare || x.CanShareAll) && selectedRows.some(x => x[ListView.IsOwner]);
        if (canShare) {
            // @ts-ignore
            ContextMenu.Instance.MenuItems.push({
                Icon: "mif-security",
                Text: "Security & Permissions",
                Click: () => this.SecurityRows()
            });
        }
    }

    /**
    * Handles security for selected rows.
    */
    async SecurityRows() {
        const md = await import('./forms/securityBL.js');
        const selectedRowIds = this.GetSelectedRows()
            .filter(x => x[ListView.IsOwner] === true)
            .map(x => x[this.IdField]?.toString());
        // @ts-ignore
        const security = new md.SecurityBL();
        security.Entity = { RecordIds: selectedRowIds, EntityId: this.Meta.ReferenceId };
        security.ParentElement = this.TabEditor.Element;
        this.TabEditor.AddChild(security);
    }


    /**
     * Loads record-specific policies for permissions handling.
     * @param {string} entity The entity reference name.
     * @param {Array<string>} ids Array of record IDs to load policies for.
     * @returns {Promise<Array>} A promise that resolves to an array of policies.
     */
    async LoadRecordPolicy(entity, ids) {
        if (ids.length === 0 || ids.every(x => x === null)) {
            return [];
        }
        const sql = {
            ComId: "Policy",
            Action: "GetById",
            Table: 'FeaturePolicy',
            MetaConn: this.MetaConn,
            DataConn: this.DataConn,
            Params: JSON.stringify({ ids, table: entity })
        };
        // @ts-ignore
        return await Client.Instance.UserSvc(sql);
    }

    /**
     * Handles the event for selected row deactivation.
     */
    async DeactivateSelected() {
        const confirmDialog = new ConfirmDialog();
        confirmDialog.Content = "Are you sure you want to deactivate?"
        confirmDialog.Render();
        confirmDialog.YesConfirmed += async () => {
            confirmDialog.Dispose();
            const deactivatedIds = await this.Deactivate();
            this.DispatchCustomEvent(this.Meta.Events, CustomEventType.Deactivated, this.Entity);
        };
    }

    /**
     * Deactivates selected rows by their IDs.
     * @returns {Promise<Array<string>>} A promise that resolves to an array of deactivated IDs.
     */
    async Deactivate() {
        const ids = this.GetSelectedRows().map(x => x[this.IdField].toString());
        const deactivatedIds = await Client.Instance.DeactivateAsync(ids, this.Meta.RefName, this.DataConn);
        if (deactivatedIds.length > 0) {
            Toast.Success("Data deactivated successfully");
        } else {
            Toast.Warning("An error occurred during deactivation");
        }
        return deactivatedIds;
    }

    /**
     * Handles deleting selected rows after confirming the action.
     */
    async HardDeleteSelected() {
        var deletedItems = [];
        deletedItems = this.GetSelectedRows();
        if (deletedItems.length == 0) {
            return;
        }
        const confirmDialog = new ConfirmDialog();
        confirmDialog.Title = "Are you sure you want to delete the selected rows?";
        confirmDialog.Render();
        confirmDialog.YesConfirmed.add(() => {
            this.HardDeleteConfirmed(deletedItems).then(deletedIds => {
                this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterDeleted, deletedIds);
            });
        });
    }

    /**
     * Confirms the deletion of selected rows and performs the deletion.
     * @param {Array<object>} deletedItems Items to be deleted.
     * @returns {Promise<Array<object>>} A promise that resolves to the array of deleted items.
     */
    async HardDeleteConfirmed(deletedItems) {
        const ids = deletedItems.map(x => x[this.IdField]).filter(x => x != null);
        const result = await Client.Instance.HardDeleteAsync(ids, this.Meta.RefName, this.DataConn);
        if (result.status == 200) {
            this.AllListViewItem.filter(x => x.Selected).forEach(x => x.Dispose());
            if (this.Meta.IsRealtime) {
                this.Dirty = false;
            }
            Toast.Success("Data deleted successfully");
        } else {
            Toast.Warning("No rows were deleted");
        }
        return deletedItems;
    }

    /**
 * Duplicates the selected rows and optionally adds a new row based on the duplicate.
 * @param {Event} ev The event object (not used in this method).
 * @param {boolean} addRow Whether to add a new row based on the duplication.
 */
    async DuplicateSelected(ev, addRow = false) {
        const originalRows = this.GetSelectedRows();
        const copiedRows = originalRows.map(row => ({ ...row }));
        Toast.Success("Duplicating data!");
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforePasted, originalRows, copiedRows).then(() => {
            let index = addRow ? 0 : this.MainSection.Children.length;
            this.AddRowsNo(copiedRows, index).then(list => {
                this.RenderIndex();
                this.ClearSelected();
                Toast.Success("Data duplicated successfully!");
            });
        });
    }

    /**
     * Adds rows at a specified index without clearing existing data.
     * @param {Array<object>} rows Array of row data to add.
     * @param {number} index The index at which to insert the new rows.
     * @returns {Promise<Array<ListViewItem>>} A promise that resolves to an array of added ListViewItem instances.
     */
    AddRowsNo(rows, index = 0) {
        let ok, err;
        let promise = new Promise((a, b) => { ok = a; err = b; });
        this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforeCreatedList, rows).then(() => {
            const tasks = rows.map((data, i) => this.AddRow(data, index + i, false));
            Promise.all(tasks).then(results => {
                this.AddNewEmptyRow();
                ok(results);
                this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterCreatedList, rows).then();
            }).catch(err);
        });
        return promise;
    }

    /**
     * Updates pagination details based on the current data state.
     */
    RenderIndex() {
        if (this.MainSection.Children.length === 0) {
            return;
        }
        this.AllListViewItem.forEach((row, rowIndex) => {
            if (row.Children.length === 0 || row.FirstChild === null || row.FirstChild.Element === null) {
                return;
            }
            const previous = row.FirstChild.Element.closest('td').previousElementSibling;
            if (previous === null) {
                return;
            }
            const index = this.Paginator.Options.StartIndex + rowIndex;
            previous.innerHTML = index.toString();
            row.Selected = this.SelectedIds.includes(row.Entity[this.IdField]);
            row.RowNo = index;
        });
    }

    /**
     * Handles custom events based on row changes, applying data updates and managing component state.
     * @param {object} rowData The data of the row that triggered the change.
     * @param {ListViewItem} rowSection The ListViewItem corresponding to the row.
     * @param {ObservableArgs} observableArgs Additional arguments or data relevant to the event.
     * @param {EditableComponent} [component=null] Optional component that might be affected by the row change.
     * @returns {Promise<boolean>} A promise that resolves to a boolean indicating success or failure of the event handling.
     */
    RowChangeHandler(rowData, rowSection, observableArgs, component = null) {
        const tcs = new Promise((resolve, reject) => {
            if (!rowSection.EmptyRow || !this.Editable) {
                this.DispatchEvent(this.Meta.Events, EventType.Change, rowData).then(() => {
                    resolve(false);
                });
            } else {
                this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforeCreated, rowData).then(() => {
                    this.RowData.Data.push(rowData);
                    this.Entity[this.Name] = this.RowData.Data;
                    rowSection.FilterChildren(child => true).forEach(child => {
                        child.EmptyRow = false;
                        child.UpdateView(true);
                    });
                    this.EmptySection.Children.Clear();
                    this.AddNewEmptyRow();
                    this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterCreated, rowData).then(() => {
                        resolve(true);
                    });
                });
            }
        });
        return tcs;
    }

    /**
    * Removes a row from the ListView by its identifier.
    * @param {string} id The identifier of the row to remove.
    */
    RemoveRowById(id) {
        const row = this.RowData.Data.find(x => x[this.IdField] === id);
        if (row) {
            this.RowData.Data.splice(this.RowData.Data.indexOf(row), 1);
            const listViewItem = this.MainSection.Children.find(x => x.EntityId === id);
            if (listViewItem) {
                listViewItem.Dispose();
            }
        }
    }

    /**
     * Adds a single row to the ListView.
     * @param {object} rowData The data object representing the row.
     * @param {number} index The index at which to insert the new row.
     * @param {boolean} singleAdd Specifies whether to add the row as a single addition.
     * @returns {Promise<ListViewItem>} A promise that resolves to the ListViewItem added.
     */
    async AddRow(rowData, index = 0, singleAdd = true) {
        if (singleAdd) {
            this.RowData.Data.splice(index, 0, rowData);
        }
        await this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforeCreated, rowData);
        const row = this.RenderRowData(this.Header, rowData, this.MainSection, index);
        await this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterCreated, rowData);
        return row;
    }

    /**
     * Adds multiple rows to the ListView.
     * @param {Array<object>} rows An array of objects to be added as rows.
     * @param {number} index The starting index to add new rows.
     * @returns {Promise<Array<ListViewItem>>} A promise that resolves to an array of ListViewItem instances.
     */
    async AddRows(rows, index = 0) {
        await this.DispatchCustomEvent(this.Meta.Events, CustomEventType.BeforeCreatedList, rows);
        const listItems = [];
        for (let i = 0; i < rows.length; i++) {
            const row = await this.AddRow(rows[i], index + i, false);
            listItems.push(row);
        }
        await this.DispatchCustomEvent(this.Meta.Events, CustomEventType.AfterCreatedList, rows);
        this.AddNewEmptyRow();
        return listItems;
    }

    /**
     * Clears selected rows based on provided criteria or clears all if no criteria provided.
     */
    ClearSelected() {
        this.SelectedIds.forEach(id => {
            const row = this.AllListViewItem.find(x => x.Entity[this.IdField] === id);
            if (row) {
                row.Selected = false;
            }
        });
        /** @type {string[]} */
        this.SelectedIds = [];
        this.LastListViewItem = null;
    }

    /**
     * Updates a specific row in the ListView.
     * @param {object} rowData The data object that represents the row to update.
     * @param {boolean} force Whether to force the update regardless of the current state.
     * @param {Array<string>} fields Specific fields to update, if provided.
     */
    UpdateRow(rowData, force = false, fields = []) {
        const row = this.AllListViewItem.find(x => x.Entity === rowData);
        if (row) {
            row.UpdateView(force, fields);
        }
    }

    DomLoaded() {
        if (!this.Meta.LocalRender) {
            this.Header.ForEach(x => x.LocalData = null);
        }
        this.DOMContentLoaded?.invoke();
    }

    /**
     * Renders additional content after rows have been added or updated.
     */
    ContentRendered() {
        this.RenderIndex();
        this.DomLoaded();
        if (this.Editable) {
            this.AddNewEmptyRow();
        }
        if (this.RowData.Data.length === 0 && !this.Editable) {
            this.NoRecordFound();
        } else {
            this.DisposeNoRecord();
        }
        if (this.Editable) {
            this.MainSection.Element.addEventListener('contextmenu', this.BodyContextMenuHandler.bind(this));
        }
    }

    /**
     * Handles no record found scenario, showing a specific message or element.
     */
    NoRecordFound() {
        if (this.MainSection.Children.length > 0) {
            this.MainSection.Children.forEach(child => child.Dispose());
        }
        this.DisposeNoRecord();
        this._noRecord = new Section(ElementType.div);
        this._noRecord.ParentElement = this.Element;
        this.AddChild(this._noRecord);
        this._noRecord.Element.AddClass('no-records');
        Html.Take(this._noRecord.Element).InnerHTML('No record found');
        this.DomLoaded();
    }

    /**
     * Disposes of any 'no record found' elements or messages.
     */
    DisposeNoRecord() {
        if (this._noRecord) {
            this._noRecord.Dispose();
            this._noRecord = null;
        }
    }

    GetItemFocus() {
        return this.AllListViewItem.Where(x => x.Focused()).FirstOrDefault();
    }

    GetRealTimeSelectedRows() {
        return new Promise((resolve, reject) => {
            // @ts-ignore
            Client.Instance.GetByIdAsync(this.Meta.RefName, this.DataConn || Client.DataConn, this.SelectedIds.ToArray())
                .then(res => {
                    resolve(res ? res.slice() : []);
                })
                .catch(error => {
                    reject(error);
                });
        });
    }

    GetRowCountByHeight(scrollTop) {
        return (scrollTop / this._rowHeight >= 0) ?
            Math.floor(scrollTop / this._rowHeight) :
            Math.ceil(scrollTop / this._rowHeight);
    }

    RemoveRow(row) {
        if (row === null) {
            return;
        }
        this.RowData.Data.Remove(row);
        this.MainSection.FirstOrDefault(x => x.Entity == row)?.Dispose();
    }

    CalcTextAlign(header) {
        if (header.TextAlign && header.TextAlign.length > 0) {
            const parsed = Object.values(header.TextAlign).includes(header.textAlign);
            if (parsed) {
                header.textAlignEnum = header.textAlign;
            }
        }
        return header;
    }

    MergeComponent(sysSetting, userSetting) {
        if (!userSetting) return sysSetting;
        const column = JSON.parse(userSetting.value);
        if (!column || column.length === 0) {
            return sysSetting;
        }
        const userSettings = column.reduce((acc, current) => {
            acc[current.id] = current;
            return acc;
        }, {});

        sysSetting.forEach(component => {
            const current = userSettings[component.id];
            if (current) {
                component.width = current.width;
                component.maxWidth = current.maxWidth;
                component.minWidth = current.minWidth;
                component.order = current.order;
                component.frozen = current.frozen;
            }
        });
        return sysSetting;
    }

    ActionFilter() {
        this.ClearRowData();
        this.ReloadData().Done();
    }

    MoveUp() {
        this.ClearSelected();
        if (this.SelectedIndex <= 0 || this.SelectedIndex === this.AllListViewItem.length) {
            this.SelectedIndex = this.AllListViewItem.length - 1;
        }
        this.RowAction(x => {
            if (x instanceof ListViewItem) {
                x.Selected = true;
            }
            // @ts-ignore
        }, true);
    }

    MoveDown() {
        this.ClearSelected();
        if (this.SelectedIndex === -1 || this.SelectedIndex === this.AllListViewItem.length) {
            this.SelectedIndex = 0;
        }
        this.RowAction(x => {
            if (x instanceof ListViewItem) {
                x.Selected = true;
            }
            // @ts-ignore
        }, false);
    }

    GetUserSetting(prefix) {
        // @ts-ignore
        return Client.Instance.UserSvc({
            MetaConn: this.MetaConn,
            DataConn: this.DataConn,
            ComId: "UserSetting",
            Action: "GetByComId",
            Params: JSON.stringify({ ComId: this.Meta.Id, Prefix: prefix })
        });
    }

    /**
     * Updates a specific row in the ListView.
     * @param {ListViewItem} rowData The data object that represents the row to update.
     */
    async RealtimeUpdateAsync(rowData, arg) {
        if (this.EmptyRow) {
            this.EmptyRow = false;
            return;
        }
        if (!this.Meta.IsRealtime || !arg) {
            return;
        }
        var isValid = await rowData.ValidateAsync();
        if (!isValid) {
            return;
        }
        await rowData.PatchUpdateOrCreate();
    }
}
