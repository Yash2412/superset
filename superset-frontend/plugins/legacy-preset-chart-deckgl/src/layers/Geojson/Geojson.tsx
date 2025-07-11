/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { memo, useCallback, useMemo, useRef } from 'react';
import { GeoJsonLayer } from '@deck.gl/layers';
// ignoring the eslint error below since typescript prefers 'geojson' to '@types/geojson'
// eslint-disable-next-line import/no-unresolved
import { Feature, Geometry, GeoJsonProperties } from 'geojson';
import geojsonExtent from '@mapbox/geojson-extent';
import {
  FilterState,
  HandlerFunction,
  JsonObject,
  JsonValue,
  QueryFormData,
  SetDataMaskHook,
} from '@superset-ui/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../../DeckGLContainer';
import { hexToRGB } from '../../utils/colors';
import sandboxedEval from '../../utils/sandbox';
import { commonLayerProps } from '../common';
import TooltipRow from '../../TooltipRow';
import fitViewport, { Viewport } from '../../utils/fitViewport';
import { TooltipProps } from '../../components/Tooltip';
import { Point } from '../../types';
import { GetLayerType } from '../../factory';

type ProcessedFeature = Feature<Geometry, GeoJsonProperties> & {
  properties: JsonObject;
  extraProps?: JsonObject;
};

const propertyMap = {
  fillColor: 'fillColor',
  color: 'fillColor',
  fill: 'fillColor',
  'fill-color': 'fillColor',
  strokeColor: 'strokeColor',
  'stroke-color': 'strokeColor',
  'stroke-width': 'strokeWidth',
};

const alterProps = (props: JsonObject, propOverrides: JsonObject) => {
  const newProps: JsonObject = {};
  Object.keys(props).forEach(k => {
    if (k in propertyMap) {
      newProps[propertyMap[k as keyof typeof propertyMap]] = props[k];
    } else {
      newProps[k] = props[k];
    }
  });
  if (typeof props.fillColor === 'string') {
    newProps.fillColor = hexToRGB(props.fillColor);
  }
  if (typeof props.strokeColor === 'string') {
    newProps.strokeColor = hexToRGB(props.strokeColor);
  }

  return {
    ...newProps,
    ...propOverrides,
  };
};
let features: ProcessedFeature[] = [];
const recurseGeoJson = (
  node: JsonObject,
  propOverrides: JsonObject,
  extraProps?: JsonObject,
) => {
  if (node?.features) {
    node.features.forEach((obj: JsonObject) => {
      recurseGeoJson(obj, propOverrides, node.extraProps || extraProps);
    });
  }
  if (node?.geometry) {
    const newNode = {
      ...node,
      properties: alterProps(node.properties, propOverrides),
    } as ProcessedFeature;
    if (!newNode.extraProps) {
      newNode.extraProps = extraProps;
    }
    features.push(newNode);
  }
};

function setTooltipContent(o: JsonObject) {
  return (
    o.object?.extraProps && (
      <div className="deckgl-tooltip">
        {Object.keys(o.object.extraProps).map((prop, index) => (
          <TooltipRow
            key={`prop-${index}`}
            label={`${prop}: `}
            value={`${o.object.extraProps?.[prop]}`}
          />
        ))}
      </div>
    )
  );
}

const getFillColor = (feature: JsonObject) => feature?.properties?.fillColor;
const getLineColor = (feature: JsonObject) => feature?.properties?.strokeColor;

export const getLayer: GetLayerType<GeoJsonLayer> = function ({
  formData,
  onContextMenu,
  filterState,
  setDataMask,
  payload,
  setTooltip,
  emitCrossFilters,
}) {
  const fd = formData;
  const fc = fd.fill_color_picker;
  const sc = fd.stroke_color_picker;
  const fillColor = [fc.r, fc.g, fc.b, 255 * fc.a];
  const strokeColor = [sc.r, sc.g, sc.b, 255 * sc.a];
  const propOverrides: JsonObject = {};
  if (fillColor[3] > 0) {
    propOverrides.fillColor = fillColor;
  }
  if (strokeColor[3] > 0) {
    propOverrides.strokeColor = strokeColor;
  }

  features = [];
  recurseGeoJson(payload.data, propOverrides);

  let processedFeatures = features;
  if (fd.js_data_mutator) {
    // Applying user defined data mutator if defined
    const jsFnMutator = sandboxedEval(fd.js_data_mutator);
    processedFeatures = jsFnMutator(features) as ProcessedFeature[];
  }

  return new GeoJsonLayer({
    id: `geojson-layer-${fd.slice_id}` as const,
    data: processedFeatures,
    extruded: fd.extruded,
    filled: fd.filled,
    stroked: fd.stroked,
    getFillColor,
    getLineColor,
    getLineWidth: fd.line_width || 1,
    pointRadiusScale: fd.point_radius_scale,
    lineWidthUnits: fd.line_width_unit,
    ...commonLayerProps({
      formData: fd,
      setTooltip,
      setTooltipContent,
      setDataMask,
      filterState,
      onContextMenu,
      emitCrossFilters,
    }),
  });
};

export type DeckGLGeoJsonProps = {
  formData: QueryFormData;
  payload: JsonObject;
  setControlValue: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter: HandlerFunction;
  height: number;
  width: number;
  filterState: FilterState;
  onContextMenu: HandlerFunction;
  setDataMask: SetDataMaskHook;
};

export function getPoints(data: Point[]) {
  return data.reduce((acc: Array<any>, feature: any) => {
    const bounds = geojsonExtent(feature);
    if (bounds) {
      return [...acc, [bounds[0], bounds[1]], [bounds[2], bounds[3]]];
    }

    return acc;
  }, []);
}

const DeckGLGeoJson = (props: DeckGLGeoJsonProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();
  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  const { formData, payload, setControlValue, onAddFilter, height, width } =
    props;

  const viewport: Viewport = useMemo(() => {
    if (formData.autozoom) {
      const points = getPoints(payload.data.features) || [];

      if (points.length) {
        return fitViewport(props.viewport, {
          width,
          height,
          points: getPoints(payload.data.features) || [],
        });
      }
    }
    return props.viewport;
  }, [
    formData.autozoom,
    height,
    payload?.data?.features,
    props.viewport,
    width,
  ]);

  const layer = getLayer({
    onContextMenu: props.onContextMenu,
    filterState: props.filterState,
    setDataMask: props.setDataMask,
    setTooltip,
    onAddFilter,
    payload,
    formData,
  });

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={payload.data.mapboxApiKey}
      viewport={viewport}
      layers={[layer]}
      mapStyle={formData.mapbox_style}
      setControlValue={setControlValue}
      height={height}
      width={width}
    />
  );
};

export default memo(DeckGLGeoJson);
