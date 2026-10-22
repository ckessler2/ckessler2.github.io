clear; clc; close all

e_x = 0.04;
opt =[5.182184521	0.807506507	0.105977518	4.936811621	1.499580107	0.238565281	2.852890077	0.368933365	1.730018894 e_x];

t = 0:0.1:50; 
% initial conditions for v_xp, v_yp, omega, theta, x, y
% eps in Matlab gives a value close to 0
Y0 = [2.2; 0; 0; -0.2; 0.; 0.]; % Cathal's % Y0 = [0.1; 0.1; 0.1; 0.1; 0.1; 0.1]; % mine

% Jump to state 2
% Y0 = [1.1569023891485377; -0.7224070740896313;  0; 0.03300836234265729; 0.; 0.];

% Jump to state 3
% Y0 = [1.3951749150824846; -0.4904804377758627;  0; -0.005871429288530726; 0.; 0.];

% Using SI units, instead of the units in LiJFM2022, is not a problem since
% the code is non dimensional 
l = 5*10^-2;    % % % p(1) = 5.1*10^-2; % p(1) = 5.1 LiJFM2022 
h = l*0.002;      % % % p(2) = p(1)*0.002;
rho_s = 1.4*10^3; % % % p(3) = 1.4*10^3; % p(3) = 1.4 LiJFM2022 
rho_f = 1.225;    % % % p(4) = 1.225; % p(4) = 1.225*10^-3; LiJFM2022 
l_CE = l*0;     % % % p(5) = p(1)*0.0;
% e_x = 0.08;       % % % p(6) = 0.00;
g = 9.80665;      % % % p(7) = 9.80665; % p(7) = 980.665; 


[tSol, ySol] = ode45(@(t, y) nondimfreelyfallingplate2(t, y, opt(1:10)), t, Y0);

v_xp = ySol(:,1);
v_yp = ySol(:,2);
omega = ySol(:,3);
theta = ySol(:,4);
% x, horizontal coordinate in reference system linked to the lab
x_ = ySol(:,5);
% y, horizontal coordinate in reference system linked to the lab
y_ = ySol(:,6);
t = tSol;

plot(x_,y_); daspect([1 1 1]); box on; 
figure; box on; grid off; hold on
plot(t, v_xp, "Color", [0 0 1]);
plot(t, v_yp, "Color",  [1 0 0]);
plot(t, omega, "Color",  [0 1 0]);
plot(t, theta, "Color",  [0 1 1]);
pbaspect([3 1 1])