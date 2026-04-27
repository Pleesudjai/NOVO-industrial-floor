function export_strain_to_json()
% EXPORT_STRAIN_TO_JSON
%   Phase 1a of the strain-into-viewer integration plan (2026-04-26 v11).
%
%   Reads cleaned strain traces from each batch's fiber_data.mat and emits
%   per-route per-layer JSON files into:
%
%     Note_x/public/data/strain/<LoadStage>/<route_id>_<LAYER>.json
%
%   plus a master manifest at Note_x/public/data/strain/index.json.
%
%   Authoritative geometry source: 03 DuckDB/dfos_routes.csv (38 rows).
%   Authoritative LS<->batch mapping: docs/decisions.md v9 + v10.
%
%   Run from the project root:
%       cd 'C:\Users\chidc\ASU Dropbox\...\NOVO_Primekss_FiberOptic_2026_Active_FEN'
%       run('Note_x/scripts/export_strain_to_json.m')
%
%   Author: Chidchanok Pleesudjai (cpleesud@asu.edu)

project_root = pwd;

routes_csv = fullfile(project_root, '03 DuckDB', 'dfos_routes.csv');
if ~exist(routes_csv, 'file')
    error('Cannot find dfos_routes.csv at %s. Run from project root.', routes_csv);
end
T = readtable(routes_csv, 'Delimiter', ',', 'TextType', 'string');

out_root = fullfile(project_root, 'Note_x', 'public', 'data', 'strain');
if ~exist(out_root, 'dir'); mkdir(out_root); end

% --- Batch -> Load Stage mapping (per docs/decisions.md v12, 2026-04-26) ---
% LS1 = East   = B1 (transverse) + B4 (longitudinal)
% LS2 = West   = B2 (transverse) + B5 (longitudinal)
% LS3 = Middle = B3 (transverse) + B6 (longitudinal)  [B6 also re-scans some transverse fibres]
batches(1) = make_batch('B1','LS1_East', ...
    fullfile(project_root,'batch 1 - Tranverse','01 Plots','fiber_data.mat'));
batches(2) = make_batch('B2','LS2_West', ...
    fullfile(project_root,'batch 2 - Tranverse','01 Plots','fiber_data_22to24.mat'));
batches(3) = make_batch('B3','LS3_Middle', ...
    fullfile(project_root,'batch 3 - Tranverse','01 Plots','fiber_data_batch_3.mat'));
batches(4) = make_batch('B4','LS1_East', ...
    fullfile(project_root,'batch 4 - Logitudinal','00 Data Processing','fiber_data_batch_4.mat'));
batches(5) = make_batch('B5','LS2_West', ...
    fullfile(project_root,'batch 5 - Logitudinal','00 Data Processing','fiber_data_batch_5.mat'));
batches(6) = make_batch('B6','LS3_Middle', ...
    fullfile(project_root,'batch 6 - Logitudinal','00 Data Processing','fiber_data_batch_6.mat'));

% Fibres broken / excluded from analysis
EXCLUDE_FIBRES = {'F6','F9','F15','F17'};

manifest = struct();
manifest.generated_utc = datestr(datetime('now','TimeZone','UTC'),'yyyy-mm-ddTHH:MM:SSZ');
manifest.snapshot_policy = 'median_of_last_5_loaded_snapshots (already applied in fiber_data.mat)';
manifest.units_strain = 'microstrain';
manifest.units_position = 'meters_arc_length_from_segment_start';
manifest.load_stages = {'LS1_East','LS2_West','LS3_Middle'};
manifest.routes = struct();

n_written = 0;
n_replaced = 0;
n_skipped = 0;

for b = 1:numel(batches)
    bd = batches(b);
    fprintf('\n=== %s -> %s ===\n', bd.id, bd.LS);
    if ~exist(bd.matpath,'file')
        fprintf('  [SKIP] mat file not found: %s\n', bd.matpath);
        continue
    end

    LS_dir = fullfile(out_root, bd.LS);
    if ~exist(LS_dir,'dir'); mkdir(LS_dir); end

    S = load(bd.matpath, 'fiber_data');
    fiber_data = S.fiber_data;
    field_names = fieldnames(fiber_data);
    field_names(strcmp(field_names,'metadata')) = [];

    for ifld = 1:numel(field_names)
        fname = field_names{ifld};
        fibre_id = regexprep(fname, '_\d+$', '');

        if any(strcmp(fibre_id, EXCLUDE_FIBRES))
            fprintf('  [SKIP] %s (broken/excluded)\n', fname);
            n_skipped = n_skipped + 1;
            continue
        end

        these_routes = T(T.fibre_id == fibre_id, :);
        if height(these_routes) == 0
            fprintf('  [WARN] no routes in CSV for fibre %s (mat field %s)\n', fibre_id, fname);
            continue
        end

        F = fiber_data.(fname);
        if ~isfield(F,'segments')
            fprintf('  [WARN] %s has no .segments field\n', fname);
            continue
        end

        for ir = 1:height(these_routes)
            r = these_routes(ir,:);
            seg_idx = parse_segment_indices(r.segment_indices);
            if isempty(seg_idx)
                fprintf('  [SKIP] %s: no segment indices listed in CSV\n', char(r.route_id));
                continue
            end

            for layer = {'BOT','TOP'}
                layer_str = layer{1};
                this_layer_segs = filter_by_layer(F, seg_idx, layer_str, char(r.orientation));
                if isempty(this_layer_segs); continue; end

                pos = []; str = []; seg_labels = {};
                for k = 1:numel(this_layer_segs)
                    sn = this_layer_segs(k);
                    seg_field = sprintf('seg_%d', sn);
                    if ~isfield(F.segments, seg_field); continue; end
                    sg = F.segments.(seg_field);
                    if ~isfield(sg,'position') || ~isfield(sg,'strain'); continue; end
                    pos = [pos; sg.position(:)];
                    str = [str; sg.strain(:)];
                    if isfield(sg,'label'); seg_labels{end+1} = sg.label; end %#ok<AGROW>
                end

                if isempty(pos); continue; end

                % Sort by arc-length (monotonic plot)
                [pos, sidx] = sort(pos);
                str = str(sidx);

                payload = struct();
                payload.route_id          = char(r.route_id);
                payload.fibre_id          = char(r.fibre_id);
                payload.route             = double(r.route_number);
                payload.layer             = layer_str;
                payload.load_stage        = bd.LS;
                payload.batch             = bd.id;
                payload.orientation       = char(r.orientation);
                payload.viewer_axis       = char(r.viewer_axis);
                payload.viewer_position_m = double(r.viewer_position_m);
                payload.reference_element = char(r.reference_element);
                payload.offset_m          = double(r.offset_m);
                payload.offset_direction  = char(r.offset_direction);
                payload.status            = char(r.status);
                payload.segments          = this_layer_segs(:)';
                payload.segment_labels    = seg_labels;
                payload.snapshot_policy   = 'median_of_last_5_loaded_snapshots';
                payload.units_strain      = 'microstrain';
                payload.units_position    = 'meters_arc_length';
                payload.n                 = numel(pos);
                payload.position          = pos(:)';
                payload.strain            = str(:)';

                out_file = fullfile(LS_dir, sprintf('%s_%s.json', char(r.route_id), layer_str));
                already_existed = exist(out_file,'file') == 2;
                fid = fopen(out_file, 'w');
                fwrite(fid, jsonencode(payload), 'char');
                fclose(fid);

                if already_existed
                    fprintf('  [REPLACE] %s/%s_%s.json (n=%d) <- %s\n', ...
                        bd.LS, char(r.route_id), layer_str, numel(pos), bd.id);
                    n_replaced = n_replaced + 1;
                else
                    fprintf('  [OK] %s/%s_%s.json (n=%d)\n', ...
                        bd.LS, char(r.route_id), layer_str, numel(pos));
                end
                n_written = n_written + 1;

                % Manifest update
                key = char(r.route_id);
                if ~isfield(manifest.routes, key)
                    manifest.routes.(key) = struct( ...
                        'fibre_id',          char(r.fibre_id), ...
                        'route_number',      double(r.route_number), ...
                        'orientation',       char(r.orientation), ...
                        'viewer_axis',       char(r.viewer_axis), ...
                        'viewer_position_m', double(r.viewer_position_m), ...
                        'reference_element', char(r.reference_element), ...
                        'status',            char(r.status), ...
                        'available',         struct());
                end
                if ~isfield(manifest.routes.(key).available, bd.LS)
                    manifest.routes.(key).available.(bd.LS) = struct('layers',{{}});
                end
                if ~any(strcmp(manifest.routes.(key).available.(bd.LS).layers, layer_str))
                    manifest.routes.(key).available.(bd.LS).layers{end+1} = layer_str;
                end
            end
        end
    end
end

manifest_file = fullfile(out_root, 'index.json');
fid = fopen(manifest_file, 'w');
fwrite(fid, jsonencode(manifest), 'char');
fclose(fid);

fprintf('\n=== DONE ===\n');
fprintf('  Wrote   : %d JSON file(s)\n', n_written);
fprintf('  Replaced: %d existing file(s)\n', n_replaced);
fprintf('  Skipped : %d fibre(s)\n', n_skipped);
fprintf('  Manifest: %s\n', manifest_file);
end


function s = make_batch(id, LS, matpath)
    s.id = id; s.LS = LS; s.matpath = matpath;
end


function indices = parse_segment_indices(s)
% Parse "1,2,11,12" -> [1 2 11 12]; returns [] for missing/empty.
if ismissing(s) || strlength(s) == 0
    indices = []; return
end
indices = str2num(char(s)); %#ok<ST2NM>
if isempty(indices); indices = []; end
end


function out_segs = filter_by_layer(F, seg_idx, layer, orientation)
% Transverse  : seg 1-6 = bottom, seg 7-12 = top (no .layer field)
% Longitudinal: read F.layer{seg_n}
out_segs = [];
for k = 1:numel(seg_idx)
    sn = seg_idx(k);
    if strcmpi(orientation,'transverse')
        if (strcmpi(layer,'BOT') && sn <= 6) || (strcmpi(layer,'TOP') && sn >= 7)
            out_segs(end+1) = sn; %#ok<AGROW>
        end
    else
        if isfield(F,'layer') && numel(F.layer) >= sn
            this_layer = F.layer{sn};
            if (strcmpi(layer,'BOT') && strcmpi(this_layer,'bottom')) || ...
               (strcmpi(layer,'TOP') && strcmpi(this_layer,'top'))
                out_segs(end+1) = sn; %#ok<AGROW>
            end
        end
    end
end
end
