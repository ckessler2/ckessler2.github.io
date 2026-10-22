% generate_dandelion_dxf.m
% Generates a radial dandelion-inspired filament outline and exports it as DXF.

clear; clc; close all;

%% Inputs
diameter_mm = 20;          % Maximum outside diameter of the full shape
filament_width_mm = 0.1;  % Width of each rectangular filament
num_filaments = 50;       % Filaments are evenly spaced over 360 degrees

output_dxf = sprintf('dandelion_D%.1f_W%.1f_N%d.dxf', ...
    diameter_mm, filament_width_mm, num_filaments);
script_dir = fileparts(mfilename('fullpath'));
if isempty(script_dir)
    script_dir = pwd;
end
output_dxf = fullfile(script_dir, output_dxf);

%% Build geometry
validateInputs(diameter_mm, filament_width_mm, num_filaments);

outer_radius = diameter_mm / 2;
half_width = filament_width_mm / 2;

% Use this length so the outer rectangle corners sit on the requested
% outside diameter instead of extending beyond it.
filament_length = sqrt(outer_radius^2 - half_width^2);

shape = polyshape();
base_x = [0, filament_length, filament_length, 0];
base_y = [-half_width, -half_width, half_width, half_width];

for k = 1:num_filaments
    theta = 2 * pi * (k - 1) / num_filaments;
    c = cos(theta);
    s = sin(theta);

    x = c .* base_x - s .* base_y;
    y = s .* base_x + c .* base_y;

    shape = union(shape, polyshape(x, y));
end

shape = simplify(shape);

%% Preview
figure('Color', 'w');
plot(shape, 'FaceColor', [0.85 0.88 0.92], 'FaceAlpha', 0.8, ...
    'EdgeColor', [0.05 0.05 0.05], 'LineWidth', 1.2);
axis equal;
grid on;
xlabel('X (mm)');
ylabel('Y (mm)');
title(sprintf('Dandelion Profile: D = %.1f mm, W = %.1f mm, N = %d', ...
    diameter_mm, filament_width_mm, num_filaments));

%% Export DXF
[bx, by] = boundary(shape);
writePolylineDxf(output_dxf, bx, by);

fprintf('Wrote DXF outline: %s\n', output_dxf);

%% Local functions
function validateInputs(diameter_mm, filament_width_mm, num_filaments)
    if ~isscalar(diameter_mm) || ~isnumeric(diameter_mm) || diameter_mm <= 0
        error('diameter_mm must be a positive number.');
    end

    if ~isscalar(filament_width_mm) || ~isnumeric(filament_width_mm) || filament_width_mm <= 0
        error('filament_width_mm must be a positive number.');
    end

    if filament_width_mm >= diameter_mm
        error('filament_width_mm must be smaller than diameter_mm.');
    end

    if ~isscalar(num_filaments) || ~isnumeric(num_filaments) || ...
            num_filaments < 1 || mod(num_filaments, 1) ~= 0
        error('num_filaments must be a positive integer.');
    end
end

function writePolylineDxf(filename, x, y)
    fid = fopen(filename, 'w');
    if fid == -1
        error('Could not open "%s" for writing.', filename);
    end

    cleaner = onCleanup(@() fclose(fid));

    fprintf(fid, '0\nSECTION\n2\nHEADER\n');
    fprintf(fid, '9\n$INSUNITS\n70\n4\n'); % 4 = millimeters
    fprintf(fid, '0\nENDSEC\n');
    fprintf(fid, '0\nSECTION\n2\nENTITIES\n');

    nan_breaks = [0; find(isnan(x(:)) | isnan(y(:))); numel(x) + 1];
    for idx = 1:numel(nan_breaks) - 1
        first = nan_breaks(idx) + 1;
        last = nan_breaks(idx + 1) - 1;

        if last - first + 1 < 2
            continue;
        end

        loop_x = x(first:last);
        loop_y = y(first:last);

        if hypot(loop_x(1) - loop_x(end), loop_y(1) - loop_y(end)) < 1e-9
            loop_x = loop_x(1:end-1);
            loop_y = loop_y(1:end-1);
        end

        fprintf(fid, '0\nLWPOLYLINE\n');
        fprintf(fid, '8\nCUT_OUTLINE\n');
        fprintf(fid, '90\n%d\n', numel(loop_x));
        fprintf(fid, '70\n1\n'); % closed polyline

        for p = 1:numel(loop_x)
            fprintf(fid, '10\n%.9f\n20\n%.9f\n', loop_x(p), loop_y(p));
        end
    end

    fprintf(fid, '0\nENDSEC\n0\nEOF\n');
end
